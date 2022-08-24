import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { check, Match } from 'meteor/check';
import gql from 'graphql-tag';
import _ from 'underscore';

import './pluginWrapper.html';
import './plugin.js';

// The purpose of this wrapper template is to establish the message receiver
// from the Pitchly platform and then relay those messages to the actual plugin
// template. It also notifies Pitchly when we're ready to receive messages, and
// it ensures that the plugin template isn't actually rendered until we've
// received the necessary messages to initiate any necessary GraphQL queries
// created in the plugin template's onCreated function. Note that the delay
// would be imperceptible because Pitchly will send messages back about the
// current workspace state immediately after receiving the "ready" message from
// this app.

Template.pluginWrapper.onCreated(function pluginWrapperOnCreated() {
  
  // Use the origin defined by platformOrigin, or fall back to this default if undefined
  this.platformOrigin = Meteor?.settings?.public?.platformOrigin || "https://platform.pitchly.com";
  
  // Hold messages sent by Pitchly in here. This will be accessed by the plugin template to get Pitchly's UI state.
  this.messages = new ReactiveDict();
  
  // ===========================================================================
  // ------------------------------- IMPORTANT!!! ------------------------------
  // ===========================================================================
  
  // The below autorun will make sure that if the account the user is logged in
  // with in the app DOES NOT match the account the user is logged into the
  // platform with, the user will be logged out of this app and forced back
  // through the OAuth flow, which should automatically log them in again, but
  // as the same user they are logged into the platform as.
  
  // If this is not done, THIS WOULD BE A SECURITY RISK because the user currently
  // logged into the app could be receiving messages about the UI state for another
  // user in the platform, even potentially in another organization. Although
  // raw data isn't typically exchanged via postMessages, things like filters,
  // views, and IDs of things could be leaked and abused by another user.
  
  // ===========================================================================
  
  this.autorun(() => {
    const currentUserId = Meteor.user()?.services?.pitchly?.id;
    if (currentUserId) {
      const currentPitchlyUserId = this.messages.get("person")?.personId;
      if (currentPitchlyUserId) {
        if (currentUserId!==currentPitchlyUserId) {
          // This app is already configured to automatically log the user in
          // when they're logged out, so calling Meteor.logout() will trigger
          // them to be logged in again via the platform.
          Meteor.logout();
        }
      }
    }
  });

});

Template.pluginWrapper.onRendered(function pluginWrapperOnRendered() {
  
  // handle received postMessages from Pitchly
  
  this.receiveMessageHandler = (event) => {
    const originalEvent = event.originalEvent;
    // stop here if sender origin is different from the platform origin
    if (originalEvent.origin!==this.platformOrigin) return;
    // get message object sent by platform
    const message = originalEvent.data;
    // validate that message is in correct format
    if (!Match.test(message, Object)) return;
    if (Meteor.isDevelopment) {
      console.log("Received message from Pitchly:");
      console.log(message);
    }
    this.messages.set(message.type, message.data);
  };
  
  $(window).on("message", this.receiveMessageHandler);
  
  // tell Pitchly that our app is ready to receive messages
  
  window.parent.postMessage({ type: "ready" }, this.platformOrigin);
  
});

Template.pluginWrapper.onDestroyed(function pluginWrapperOnDestroyed() {
  
  // teardown onMessage handler
  
  $(window).off("message", this.receiveMessageHandler);
  
});

Template.pluginWrapper.helpers({
  
  // load nested plugin template once we have the current workspace ID from Pitchly
  
  ready() {
    return !!Template.instance().messages.get("workspace");
  },
  
  // the data context to pass to nested plugin template
  
  pluginData() {
    const instance = Template.instance();
    return {
      // pass ReactiveDict holding messages
      messages: instance.messages
    };
  }

});

Template.pluginWrapper.events({

});