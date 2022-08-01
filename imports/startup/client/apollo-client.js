import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client/core';
import { getMainDefinition } from '@apollo/client/utilities';
import { WebSocketLink } from '@apollo/client/link/ws';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { RetryLink } from '@apollo/client/link/retry';
import { fromPromise } from '@apollo/client/link/utils/fromPromise';
import { setup } from 'meteor/swydo:blaze-apollo';

// use the origin defined by platformOrigin, or fall back to this default if undefined
const platformOrigin = Meteor?.settings?.public?.platformOrigin || "https://platform.pitchly.com";

const httpURI = platformOrigin + "/graphql";
const wsURI = platformOrigin.replace(/^http/i, "ws") + "/subscriptions";

const httpLink = new HttpLink({
  uri: httpURI
});

// attach authorization header to each HTTP request

const authLink = setContext((_, { headers }) => {
  const token = Meteor.user()?.services?.pitchly?.accessToken;
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    }
  }
});

const wsLink = new WebSocketLink({
  uri: wsURI,
  options: {
    reconnect: true
  }
});

// attach authorization header to each websocket subscription (not just on initial connection)

wsLink.subscriptionClient.use([{
  applyMiddleware: (options, next) => {
    const token = Meteor.user()?.services?.pitchly?.accessToken;
    options.authorization = token ? `Bearer ${token}` : "";
    next();
  }
}]);

// If an HTTP request returns an "UNAUTHENTICATED" error, this will automatically
// refresh the access token and retry the original request with the new access
// token without any interruption.

// Despite the accounts-pitchly package automatically refreshing access tokens
// on page load and on a regular interval, this is still important because:
// 
//  1) Requests may be made prior to the token being totally refreshed. This will
//     cause the request to "wait" until a valid access token is acquired.
// 
//  2) Access tokens may be invalidated at any time by Pitchly, even prior to the
//     accessTokenExpiresAt date. This ensures that we get a new access token as
//     soon as we know it's invalid and we don't have to wait until the interval
//     in accounts-pitchly runs again (only runs every 6 minutes).

// Inspired from: https://stackoverflow.com/a/62872754/2658450

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    // we need to convert a Meteor.call to a function returning a promise
    const callWithPromise = (method, params) => {
      return new Promise((resolve, reject) => {
        Meteor.call(method, params, (err, res) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(res);
        });
      });
    }
    for (let err of graphQLErrors) {
      switch (err.extensions.code) {
        // this should match whatever error code Pitchly sends back when the
        // access token is invalid or expired
        case 'UNAUTHENTICATED':
          return fromPromise(
            callWithPromise("Pitchly.refreshAccessToken", { force: true }).catch((error) => {
              // Handle token refresh errors e.g clear stored tokens, redirect to login, ...
              Meteor.logout();
              return;
            })
          ).filter((value) => Boolean(value))
           .flatMap(({ refreshed, accessToken }) => {
            const oldHeaders = operation.getContext().headers;
            // modify the operation context with a new token
            operation.setContext({
              headers: {
                ...oldHeaders,
                authorization: `Bearer ${accessToken}`,
              },
            });
            // retry the request, returning the new observable
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

const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache()
});

// Convert an array of errors from Apollo into a single Meteor error object.
// This expects an array like the one received from result.getErrors() using
// blaze-apollo and returns a Meteor.Error object if an error is present. If
// there are no errors, will return undefined.

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

// clear Apollo Client cache on Meteor logout
Accounts.onLogout(() => {
  client.resetStore();
});

// make Apollo Client work with Blaze
setup({ client });

// export these variables so they can be imported and used elsewhere
export {
  client as apolloClient,
  normalizeGraphQLErrors
};