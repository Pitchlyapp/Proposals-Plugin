import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { check, Match } from 'meteor/check';
import gql from 'graphql-tag';
import _ from 'underscore';

import { normalizeGraphQLErrors } from '../../../startup/client/apollo-client.js';

import './plugin.html';

// The actual plugin interface. This includes the beginning splash screen and
// the search results screen. Messages from Pitchly live in a ReactiveDict at
// this.data.messages.

Template.plugin.onCreated(function pluginOnCreated() {
  
  // current search term
  this.search = new ReactiveVar("");
  
  // array of current image results to display
  this.images = new ReactiveVar([]);
  
  // number of total pages that make up the entire result
  this.totalPages = new ReactiveVar(0);
  
  // increment this by 1 to get each new page of results
  this.currentPage = new ReactiveVar(1);
  
  // true when new search results are loading from a new search
  this.isLoadingInitial = new ReactiveVar(false);
  
  // true if more results are loading from an existing search
  this.isLoadingMore = new ReactiveVar(false);
  
  // store any errors that occur with fetching images here
  this.error = new ReactiveVar();
  
  // this image will be shown right when the page loads as the splash background
  this.randomImage = new ReactiveVar();
  
  // this will contain the ID of the image being inserted, while actively inserting into Pitchly
  this.imageBeingInserted = new ReactiveVar();
  
  // load random image to show on initial splash screen
  
  Meteor.call("unsplash.random", (error, result) => {
    if (!error) {
      this.randomImage.set(result);
    }
  });
  
  // Get all the fields in all the tables in the workspace the user is currently
  // looking at, so we can determine whether the field the user has currently
  // selected is an attachment field or not, so we can show a warning if the
  // user doesn't currently have an attachment field selected.
  
  this.workspace = this.gqlQuery({
    query: gql`
      query workspace($id: ID!) {
        workspace(id: $id) {
          id
          tables {
            id
            fields {
              id
              type
            }
          }
        }
      }
    `,
    pollInterval: 30000, // poll every 30 seconds
    variables: {
      id: this.data.messages.get("workspace")?.workspaceId
    }
  });
  
  // We don't expect the workspace ID to change, but if we needed to re-run the
  // above query again based on a reactive change, we can use the code below.

  // this.autorun((c) => {
  //   const workspaceId = this.data.messages.get("workspace")?.workspaceId;
  //   if (!c.firstRun) {
  //     const variables = { id: workspaceId };
  //     this.workspace.observer.refetch(variables);
  //   }
  // });
  
  // Show any errors we receive when getting field data from the Pitchly API

  this.autorun(() => {
    const errors = this.workspace.getErrors();
    const error = normalizeGraphQLErrors(errors);
    if (error) {
      console.log("Error thrown when querying Pitchly API:");
      console.log(error);
      this.error.set(error.reason);
    }
  });
  
  // when search changes, get new image results
  
  this.autorun(() => {
    const search = this.search.get();
    // when search changes, empty all existing results
    this.images.set([]);
    this.totalPages.set(0);
    this.currentPage.set(1);
    if (search) {
      // loading an entirely new set of results
      this.isLoadingInitial.set(true);
      this.autorun(() => {
        // If this autorun is triggered but the parent autorun is not, it means
        // the user is paginating on an existing search, so we want to indicate
        // that with a different loading spinner.
        this.isLoadingMore.set(true);
        this.error.set();
        const currentPage = this.currentPage.get();
        Meteor.call("unsplash.search", { search, page: currentPage }, (error, result) => {
          this.isLoadingInitial.set(false);
          this.isLoadingMore.set(false);
          if (error) {
            console.log("Error thrown when fetching image results:");
            console.log(error);
            // something went wrong with the request, so show an error
            this.error.set(error.reason);
            // also empty image results and reset pagination params
            this.images.set([]);
            this.totalPages.set(0);
            this.currentPage.set(1);
          } else {
            // update num of total pages
            this.totalPages.set(result.total_pages);
            // copy "id" property to "_id" for each image, so Blaze can identify each DOM element
            const newImages = _.map(result.results, (image) => {
              image._id = image.id;
              return image;
            });
            // add the new images to the list of current images
            const currentImages = this.images.get();
            const allImages = currentImages.concat(newImages);
            this.images.set(allImages);
          }
        });
      });
    }
  });

});

Template.plugin.onRendered(function pluginOnRendered() {
  
  // Auto-focus on first input when template first loads. Tracker.afterFlush
  // will ensure that we only access the DOM AFTER Blaze has updated the UI
  // from reactive changes in the HTML template.
  
  Tracker.afterFlush(() => {
    this.$('input:first').focus();
  });
  
  // After the app is first launched, focus again on the first input each time
  // the app comes back into view after it has been closed or hidden. Pitchly
  // offers us a boolean flag indicating whether the app is visible or not via
  // the "focus" message.
  
  this.autorun(() => {
    const isAppFocused = !!this.data.messages.get("focus")?.isFocused;
    if (isAppFocused) {
      Tracker.afterFlush(() => {
        this.$('input:first').focus();
      });
    }
  });
  
});

Template.plugin.helpers({
  
  // returns list of images to render on screen
  
  images() {
    return Template.instance().images.get();
  },
  
  // the current active search term used to populate results
  
  search() {
    return Template.instance().search.get();
  },
  
  // true when entirely new results are loading from a new search
  
  isLoadingInitial() {
    return Template.instance().isLoadingInitial.get();
  },
  
  // true when loading more results via pagination
  
  isLoadingMore() {
    return Template.instance().isLoadingMore.get();
  },
  
  // true when there are more pages available to load
  
  isMoreResults() {
    const instance = Template.instance();
    return (instance.currentPage.get() < instance.totalPages.get());
  },
  
  // return any error that has occurred from trying to fetch images
  
  error() {
    return Template.instance().error.get();
  },
  
  // the random image to display in the splash background
  
  randomImage() {
    return Template.instance().randomImage.get();
  },
  
  // return true if the user currently has an attachment field selected in the data table
  
  isAttachmentFieldSelected() {
    const instance = Template.instance();
    const tables = instance.workspace.get()?.workspace?.tables || [];
    const currentTableId = instance.data.messages.get("table")?.tableId;
    const currentFieldId = instance.data.messages.get("activeCell")?.fieldId;
    if (tables.length && currentTableId && currentFieldId) {
      const table = _.findWhere(tables, { id: currentTableId });
      if (table) {
        const field = _.findWhere(table.fields, { id: currentFieldId });
        if (field) {
          if (field.type==="attachment") {
            return true;
          }
        }
      }
    }
    return false;
  },
  
  // return ID of image being inserted, while waiting for it to be inserted into Pitchly
  
  imageBeingInserted() {
    return Template.instance().imageBeingInserted.get();
  }

});

Template.plugin.events({
  
  // submit new image search
  
  'submit form'(event, instance) {
    event.preventDefault();
    const searchTerm = instance.$('.search-input').val();
    instance.search.set(searchTerm);
  },
  
  // load more results
  
  'click .load-more-button'(event, instance) {
    const currentPage = instance.currentPage.get();
    instance.currentPage.set(currentPage + 1);
  },
  
  // insert the selected image into the active cell in Pitchly
  
  'click .insert-image-button'(event, instance) {
    const $el = $(event.currentTarget);
    const imageId = $el.closest('.image').data("id");
    const images = instance.images.get();
    const image = _.findWhere(images, { id: imageId });
    if (image) {
      const tableId = instance.data.messages.get("table")?.tableId;
      const fieldId = instance.data.messages.get("activeCell")?.fieldId;
      const recordId = instance.data.messages.get("activeCell")?.recordId;
      if (tableId && fieldId && recordId) {
        // This isn't the actual image URL, but rather an endpoint URL that
        // contains a "url" property that contains the actual image URL. The
        // purpose of this, per Unsplash, is to increment the "download" count
        // of the image on Unsplash whenever the image is "downloaded".
        const downloadLink = image.links.download_location;
        instance.imageBeingInserted.set(imageId);
        Meteor.call("pitchly.updateRecord", {
          tableId,
          fieldId,
          recordId,
          downloadLink
        }, (error, result) => {
          instance.imageBeingInserted.set();
          if (error) {
            console.log("Error thrown when updating record:");
            console.log(error);
            new Lightbox("lightboxConfirm", {
              className: "lightboxDialog",
              data: {
                title: "Could not insert image",
                message: "Failed to insert image for the following reason: " + error.reason,
                type: "alert",
                danger: true
              }
            });
          } else {
            if (Meteor.isDevelopment) {
              console.log("Successfully inserted image");
            }
          }
        });
      }
    }
  }

});