import { Meteor } from 'meteor/meteor';
import { fetch, Headers } from 'meteor/fetch';
import { check, Match } from 'meteor/check';
import _ from 'underscore';

Meteor.methods({
  
  // Get a list of 10 photos from a search on Unsplash
  
  'unsplash.search'(data) {
    
    if (!Meteor.userId()) {
      throw new Meteor.Error("logged-out", "You must be logged in.");
    }
    
    check(data, {
      search: Match.Where((val) => {
        check(val, String);
        return val!=="";
      }),
      page: Match.Where((val) => {
        check(val, Match.Integer);
        return val > 0;
      })
    });
    
    const apiURL = "https://api.unsplash.com/search/photos/?client_id=" + encodeURIComponent(Meteor.settings.unsplash.accessKey) + "&query=" + encodeURIComponent(data.search) + "&page=" + encodeURIComponent(data.page);
    
    try {
      const response = fetch(apiURL).await();
      const data = response.json().await();
      return data;
    } catch (error) {
      throw new Meteor.Error("fetch-error", "Could not get photos from Unsplash.", error);
    }
    
  },
  
  // Get a single random photo from Unsplash based on a "query" param
  
  'unsplash.random'() {
    
    if (!Meteor.userId()) {
      throw new Meteor.Error("logged-out", "You must be logged in.");
    }
    
    const apiURL = "https://api.unsplash.com/photos/random/?client_id=" + encodeURIComponent(Meteor.settings.unsplash.accessKey) + "&content_filter=high&orientation=portrait&query=architecture"
    
    try {
      const response = fetch(apiURL).await();
      const data = response.json().await();
      return data;
    } catch (error) {
      throw new Meteor.Error("fetch-error", "Could not get photos from Unsplash.", error);
    }
    
  },
  
  // Upload image with the specified URL to Pitchly at the specified field and record ID
  
  // Because we want to be able to write to Pitchly from the server but not necessarily
  // allow the client-side to write directly (because the user may not have permission
  // to write to the table), the access token stored in the user document is downscoped
  // to only allow reading data (based on an empty array being passed to "accessTokenScope"
  // in the settings file).
  
  // In order to get an access token to write data to Pitchly, we need to call the
  // Pitchly client_credentials OAuth grant, which just takes the org ID, our app
  // ID, and app secret. Then we can use that access token to write to Pitchly.
  
  // This method consists of four steps:
  //  1. First, get the writeable access token
  //  2. Check if the field specified is indeed an attachment field
  //  3. Hit the downloadLink URL, which returns JSON containing the actual image URL
  //  4. Try to update that field value for the speified record with the image URL
  
  'pitchly.updateRecord'(data) {
    
    if (!Meteor.userId()) {
      throw new Meteor.Error("logged-out", "You must be logged in.");
    }
    
    check(data, {
      tableId: String,
      fieldId: String,
      recordId: String,
      downloadLink: String
    });
    
    // use the origin defined by platformOrigin, or fall back to this default if undefined
    const platformOrigin = Meteor?.settings?.public?.platformOrigin || "https://platform.pitchly.com";
    
    // hit the Unsplash download location link to get the actual image URL
    
    const getImageURL = ({ downloadLink }) => {
      try {
        const response = fetch(downloadLink + "&client_id=" + encodeURIComponent(Meteor.settings.unsplash.accessKey)).await();
        const data = response.json().await();
        return data.url;
      } catch (error) {
        throw new Meteor.Error("get-image-error", "Could not get photo from Unsplash.", error);
      }
    };
    
    // get access token with write access to the table
    
    const getAccessToken = () => {
      try {
        const response = fetch(platformOrigin + "/api/oauth/token", {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: Meteor.settings.packages["service-configuration"].pitchly.clientId,
            client_secret: Meteor.settings.packages["service-configuration"].pitchly.secret,
            organization_id: Meteor.user().services.pitchly.organizationId
          })
        }).await();
        const data = response.json().await();
        return data.access_token;
      } catch (error) {
        console.log("Error while generating Pitchly access token:");
        console.log(error);
        throw new Meteor.Error("access-token-error", "Failed to generate Pitchly access token.");
      }
    };
    
    // get table fields to check whether the field the user wants to update is in fact an attachment field
    
    const getTable = ({ accessToken, tableId }) => {
      try {
        const response = fetch(platformOrigin + "/graphql", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json" // must be included in GraphQL requests
          },
          body: JSON.stringify({
            query: `query table($id: ID!) {
              table(id: $id) {
                fields {
                  id
                  type
                }
              }
            }`,
            variables: {
              id: tableId
            }
          })
        }).await();
        const data = response.json().await();
        if (!data.data) {
          throw new Meteor.Error("fetch-error", "Could not get table fields.", data);
        }
        return data.data.table;
      } catch (error) {
        console.log("Error while updating data in Pitchly table:");
        console.log(error);
        throw new Meteor.Error("get-table-error", "Could not get table fields.");
      }
    };
    
    // update data in Pitchly table using the access token we just got
    
    const updateRecord = ({ accessToken, tableId, fieldId, recordId, attachmentURL }) => {
      try {
        const response = fetch(platformOrigin + "/graphql", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json" // must be included in GraphQL requests
          },
          body: JSON.stringify({
            query: `mutation updateRecords($tableId: ID!, $records: [UpdateRecordInput!]!) {
              updateRecords(tableId: $tableId, records: $records) {
                id
              }
            }`,
            variables: {
              tableId,
              records: [
                {
                  id: recordId,
                  fields: [
                    {
                      fieldId,
                      value: {
                        val: attachmentURL
                      }
                    }
                  ]
                }
              ]
            }
          })
        }).await();
        const data = response.json().await();
        if (!data.data) {
          throw new Meteor.Error("update-error", "Could not update table data.", data);
        }
      } catch (error) {
        console.log("Error while updating data in Pitchly table:");
        console.log(error);
        throw new Meteor.Error("update-error", "Could not update table data.");
      }
    };
    
    // Begin the multi-step process...
    
    const accessToken = getAccessToken();
    
    const table = getTable({
      accessToken,
      tableId: data.tableId
    });
    
    const field = _.findWhere(table.fields, { id: data.fieldId });
    
    if (!field || field.type!=="attachment") {
      throw new Meteor.Error("invalid-field", "The selected field is not an attachment field.");
    }
    
    // Unsplash counts this request as a "download" and will increase the download count of the image.
    // We make this a near-final step so we only count the download once we're pretty sure the update will succeed.
    const imageURL = getImageURL({ downloadLink: data.downloadLink });
    
    updateRecord({
      accessToken,
      tableId: data.tableId,
      fieldId: data.fieldId,
      recordId: data.recordId,
      attachmentURL: imageURL
    });
    
  }
  
});