import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client/core';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient, CloseCode } from 'graphql-ws';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { RetryLink } from '@apollo/client/link/retry';
import { fromPromise } from '@apollo/client/link/utils/fromPromise';
import { setup } from 'meteor/swydo:blaze-apollo';

// ===================================================================================
// ---------------------------------- PREREQUISITES ----------------------------------
// ===================================================================================
// 
// The following NPM packages must be installed to get Apollo Client to work:
// 
//  - @apollo/client  [Apollo Client itself]
//  - graphql  [Peer dependency that Apollo Client relies on]
//  - graphql-ws  [Adds WebSocket subscription support to Apollo Client]
// 
// For our purposes, we also need the following Meteor packages:
// 
//  - swydo:blaze-apollo  [Adds lifecycle hooks in Blaze templates to work with Apollo Client]
//  - pitchly:accounts-pitchly  [Provides Meteor Method call to refresh Pitchly access tokens]
//  - swydo:graphql  [Optional - Needed if you want to support .graphql files in your project]
// 
// ===================================================================================
// -------------------------------------- NOTES --------------------------------------
// ===================================================================================
// 
// Among all the complexities of initializing Apollo Client to work over HTTP
// for queries and mutations, and over WebSockets for subscriptions, the hardest
// thing to get right is the automatic refreshing of access tokens when the
// GraphQL server responds with "UNAUTHENTICATED" in an HTTP request or
// "Forbidden" in a WebSocket connection.
// 
// This file will do all of that, and it will do it all seamlessly to GraphQL
// callers, so individual queries, mutations, and subscriptions do not need to
// concern themselves with any of the retry logic due to faulty network
// connections or expired access tokens.
// 
// Note that while the accounts-pitchly package DOES automatically refresh
// access tokens on page load and on regular intervals already, there are some
// situations where this falls short and we need to auto-refresh on a per-
// failed-request basis:
// 
//  1) The page is freshly loaded after a period of inactivity. Sometimes, a
//     query may be initialized BEFORE a new access token is finished being
//     acquired. Refreshing on a failed-request basis will cause the request to
//     "wait" until a new valid access token is acquired.
// 
//  2) The Pitchly platform may invalidate access tokens at any time, even
//     before the original access token was set to expire. But the interval only
//     intends on refreshing the access token on the original expiration date,
//     so the interval may not refresh the access token quickly enough. By
//     refreshing as soon as a request tells us it's invalid, the access token
//     is refreshed immediately, as soon as we know it's expired, and we don't
//     have to wait until the interval in accounts-pitchly runs again to acquire
//     a new access token. (Currently, the interval in accounts-pitchly only
//     runs once every 6 minutes.)



// ===================================================================================
// -- Variable and function definitions used throughout Apollo Client initialization -
// ===================================================================================

// Use the origin defined by platformOrigin, or fall back to this default if undefined

const platformOrigin = Meteor?.settings?.public?.platformOrigin || "https://platform.pitchly.com";

// The full URL location of the GraphQL HTTP endpoint and WebSocket endpoint

const httpURI = platformOrigin + "/graphql";
const wsURI = platformOrigin.replace(/^http/i, "ws") + "/subscriptions";

// Call this to perform a Meteor.call but return a Promise instead of using callbacks

const meteorCallWithPromise = (method, params) => {
  return new Promise((resolve, reject) => {
    Meteor.call(method, params, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    });
  });
};

// Call this to forcefully refresh the current user's access token

const refreshAccessToken = () => {
  return meteorCallWithPromise("Pitchly.refreshAccessToken", { force: true });
};

// This gets called when Apollo attempts to get a new access token because Pitchly
// told it the current one isn't valid but then the refresh also fails. In this case,
// the user needs to be sent back through the OAuth flow to get a new access token
// and refresh token. We do that by logging the user out, which will redirect them
// back through the OAuth flow.

// Error will depend on which kind of transportMethod is used. transportMethod is
// either "http" or "ws" depending if the error was thrown via an HTTP request or
// WebSocket connection.

const onRefreshTokenFailure = (error, transportMethod) => {
  Meteor.logout();
};

// This gets called when the user changes login state either because they logged
// out or switched to a different user account. client.resetStore() will both
// clear the Apollo cache and rerun all active queries, making it so we don't
// accidentally leak any user data across login states.

const cleanupUserSession = () => {
  client.resetStore();
};

// Convert an array of errors from Apollo into a single Meteor error object.
// This expects an array like the one received from result.getErrors() using
// blaze-apollo and returns a Meteor.Error object if an error is present. If
// there are no errors, will return undefined. This function is only here so
// that it can be imported and used elsewhere to normalize error handling.

const normalizeGraphQLErrors = function(errors) {
  if (errors && errors.length > 0) {
    const error = errors[0];
    if (error.networkError) {
      // network error, e.g. failed to connect to server because of internet connectivity issues...
      return new Meteor.Error("NETWORK_ERROR", "Couldn't connect to Pitchly. Please try again.", error.networkError);
    } else {
      if (error.graphQLErrors && error.graphQLErrors.length > 0) {
        // application error...
        const gqlError = error.graphQLErrors[0];
        return new Meteor.Error(gqlError.extensions.code, gqlError.message, gqlError);
      } else {
        // probably won't happen, but just in case...
        return new Meteor.Error("INTERNAL_SERVER_ERROR", "There was an internal error. Please try again.", error);
      }
    }
  }
};



// ===================================================================================
// ----- Start constructing Apollo Links to apply to Apollo Client initialization ----
// ===================================================================================

// Create WebSocket link to handle GraphQL subscriptions over WebSockets.

// Like HTTP requests, we do all the same things here with WebSockets, including
// automatically retrying failed requests, seamlessly refreshing access tokens
// when expired and then retrying the request, and including the user's access
// token in the request BUT all of these are done differently with WebSockets.

// graphql-ws automatically retries WebSocket connections when there are issues.
// Each time a connection is attempted, the connectionParams callback is rerun,
// providing the opportunity to refresh the user's access token if necessary or
// attach an existing access token to the request.

// On the Pitchly side, Pitchly platform's servers will automatically close any
// WebSocket and return "Forbidden" in the close code whenever EITHER a WebSocket
// first connects with an invalid access token OR a subscription is initialized
// with an invalid access token.

// When a "Forbidden" close code is detected, we basically just set a flag to
// tell connectionParams that the next time it tries to reconnect, it should
// refresh the user's access token before retrying. This all happens behind the
// scenes seamlessly, so the subscription caller does not need to handle this
// situation manually on each subscription.

// Code for this pattern was taken from:
// - https://www.apollographql.com/docs/react/data/subscriptions/
// - https://github.com/enisdenjo/graphql-ws#auth-token
//   (see section, "ws server and client auth usage with token expiration, validation and refresh")

let shouldRefreshToken = false;

const wsLink = new GraphQLWsLink(createClient({
  url: wsURI,
  connectionParams: async () => {
    let token = Meteor.user()?.services?.pitchly?.accessToken;
    if (shouldRefreshToken) {
      try {
        const { refreshed, accessToken } = await refreshAccessToken();
        token = accessToken;
        if (Meteor.isDevelopment) {
          console.log("Retrying GraphQL websocket subscription because server closed the socket with 'Forbidden'...");
        }
      } catch (error) {
        onRefreshTokenFailure(error, "ws");
      }
      shouldRefreshToken = false;
    }
    return { authorization: token ? `Bearer ${token}` : "" };
  },
  on: {
    closed: (event) => {
      // If WebSocket is closed with the `4403: Forbidden` close event, the
      // client or the server is communicating that the token is no longer
      // valid and should be therefore refreshed.
      if (event.code===CloseCode.Forbidden) {
        shouldRefreshToken = true;
      }
    }
  }
}));

// Create HTTP link to handle GraphQL queries and mutations over HTTP

const httpLink = new HttpLink({
  uri: httpURI
});

// Attach authorization header to each HTTP request

const authLink = setContext((_, { headers }) => {
  const token = Meteor.user()?.services?.pitchly?.accessToken;
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    }
  }
});

// This errorLink will automatically detect HTTP requests that have returned an
// "UNAUTHENTICATED" error and automatically refresh the user's access token and
// retry the request seamlessly without the query caller being notified of any
// error.

// Inspired from: https://stackoverflow.com/a/62872754/2658450

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    for (let err of graphQLErrors) {
      switch (err.extensions.code) {
        // This should match whatever error code Pitchly sends back when the
        // access token is invalid or expired.
        case 'UNAUTHENTICATED':
          return fromPromise(
            refreshAccessToken().catch((error) => {
              onRefreshTokenFailure(error, "http");
            })
          ).filter((value) => Boolean(value))
           .flatMap(({ refreshed, accessToken }) => {
            const oldHeaders = operation.getContext().headers;
            // Modify the operation context with a new token
            operation.setContext({
              headers: {
                ...oldHeaders,
                authorization: `Bearer ${accessToken}`,
              },
            });
            // Retry the request, returning the new observable
            if (Meteor.isDevelopment) {
              console.log("Retrying GraphQL request because server returned 'UNAUTHENTICATED'...");
            }
            return forward(operation);
          });
      }
    }
  }
});

// Will automatically retry requests that fail due to network errors (e.g. the user
// loses internet connectivity). By default, the request will be retried in 300ms
// with exponential backoff up to 5 times, which means the request will only throw
// back an error if it repeatedly fails for at least 4800ms (almost 5 seconds).

const retryLink = new RetryLink();

// Direct queries and mutations to HTTP, while subscriptions get directed to
// WebSockets. Here is also where we apply all the other HTTP links that act
// as middleware to HTTP requests, like adding the Authorization header,
// refreshing access tokens, and retrying failed requests due to network error.

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    );
  },
  wsLink,
  // retryLink executes first, httpLink last
  retryLink.concat(errorLink.concat(authLink.concat(httpLink)))
);

// Create Apollo Client

const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache()
});



// ===================================================================================
// ---------- Miscellaneous supplemental functions to do with Apollo Client ----------
// ===================================================================================

// When the current user is either logged out or the user has switched user accounts,
// call cleanupUserSession() to handle things like clearing the Apollo cache.

// Handle logout

Accounts.onLogout(() => {
  cleanupUserSession();
});

// Handle changing accounts

Tracker.autorun((c) => {
	Meteor.userId();
  if (!c.firstRun) {
  	Tracker.nonreactive(() => {
      cleanupUserSession();
  	});
  }
});

// Make Apollo Client work with Blaze

setup({ client });



// Export these variables so they can be imported and used elsewhere

export {
  client as apolloClient,
  normalizeGraphQLErrors
};