Accounts.config({
  // Prevents clients from being able to create accounts directly
  forbidClientAccountCreation: true
});

// Prevents clients from being able to update their user document
// directly. In Meteor, the "profile" field is writeable directly
// by default. This disables that.

Meteor.users.deny({
  update() { return true; }
});