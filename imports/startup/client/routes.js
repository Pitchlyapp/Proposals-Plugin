import { Meteor } from 'meteor/meteor';
import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { BlazeLayout } from 'meteor/kadira:blaze-layout';
import _ from 'underscore';

// import layouts
import '../../ui/body.js';
import '../../ui/layouts/home/home.js';
import '../../ui/layouts/plugin/pluginWrapper.js';



// We created this option in FlowRouter ourselves to fix a bug that exists where
// query params get decoded twice and corrupt URL data. This flag fixes that.
// See our pull request: https://github.com/veliovgroup/flow-router/pull/92

FlowRouter.decodeQueryParamsOnce = true;



// This bit of code forces page templates to be completely re-rendered when the
// user's login state changes (logged in/out or switched accounts) if the user is
// currently viewing one of the below protected routes. Without this, account-
// protected pages are not automatically re-rendered when the user changes accounts,
// even though account-protected pages are generally assumed to be designed around
// the context of a single account.

// The mechanism in which this works is by overriding BlazeLayout's render function
// so that it can be re-executed as-is when the user's login state changes, but only
// if the user's route matches a protected route (so that it doesn't automatically
// happen on every route).

const protectedRoutes = [
	"home",
  "plugin"
];

const originalBlazeLayoutRenderFunc = BlazeLayout.render;
let onLoginStateChange = null;

Tracker.autorun(() => {
	Meteor.userId();
	Tracker.nonreactive(() => {
		if (onLoginStateChange) {
			onLoginStateChange();
		}
	});
});

BlazeLayout.render = function(...args) {
	originalBlazeLayoutRenderFunc(...args);
	const routeName = FlowRouter.getRouteName();
	if (_.contains(protectedRoutes, routeName)) {
		onLoginStateChange = () => {
			// close any open lightboxes, since clearing the page template does not clear open lightboxes
			$('.lightbox').each(function() {
				const $children = $(this).children(":first");
				if ($children.length) {
					// gets lightbox template's data context, which contains lightbox instance
					const data = Blaze.getData($children.get(0));
					if (typeof data=="object" && data!==null && data.lightbox) {
						data.lightbox.destroy(); // close lightbox
					}
				}
			});
			// re-render page template
			BlazeLayout.reset(); // clear current template
			BlazeLayout.render(...args); // re-render template
		};
	} else {
		onLoginStateChange = null;
	}
};



// If user isn't logged in already, log them in

Tracker.autorun(() => {
  if (!Meteor.loggingIn()) {
    if (!Meteor.user()) {
      if (Accounts.loginServicesConfigured()) {
        Meteor.loginWithPitchly();
      }
    }
  }
});



// Don't initiate routes until the user is logged in, so we can safely assume
// in layout templates that the user is already logged in.

FlowRouter.wait();

Tracker.autorun(() => {
  if (Meteor.user()) {
		// Sometimes, FlowRouter throws an extraneous error when it has been initialized
		// multiple times. This try-catch just keeps it from polluting the JS console.
		try {
	    FlowRouter.initialize();
		} catch (error) {}
  }
});



// home screen

FlowRouter.route('/', {
  name: "home",
  action() {
    BlazeLayout.reset(); // force full re-render
    BlazeLayout.render("home");
  }
});



// plugin screen (shows in right pane of workspace inside Pitchly)

FlowRouter.route('/plugin', {
  name: "plugin",
  action() {
    BlazeLayout.reset(); // force full re-render
    BlazeLayout.render("pluginWrapper");
  }
});



// when user hits a page that doesn't exist, redirect to home (404 catch-all)

FlowRouter.route('*', {
  action() {
    FlowRouter.go("/");
  }
});