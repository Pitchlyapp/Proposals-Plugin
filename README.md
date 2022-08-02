# Unsplash app for Pitchly

With the Unsplash app for Pitchly, you can search from [Unsplash](https://unsplash.com/)'s catalog of countless photos from hundreds of thousands of photographers, and quickly and easily insert those photos directly into your Pitchly database.

> :warning: **Do not clone this repo until you've read below!**

<kbd>![Screenshot from 2022-08-01 16-01-59](https://user-images.githubusercontent.com/4737526/182246273-80ca8117-62e0-4dc9-ba51-cadfe95996ab.png)</kbd>

## How to run

1. First, register this app with the [Pitchly Workspaces platform](https://platform.pitchly.com/). Make sure the app is given `records:update` permission. Take note of the **App ID** and **App Secret** Pitchly gives you in return.

2. Clone the app and install all packages:
```
git clone --recursive git@github.com:Pitchlyapp/unsplash-app.git && cd unsplash-app && meteor npm install
```
> :bangbang: Including the `--recursive` flag in your `clone` command is important because it will tell Git to automatically also clone all Git submodules inside the app.

> :lock: If you get asked to enter your GitHub credentials, create a new [Personal Access Token](https://github.com/settings/tokens) with "repo" privileges and paste it in as your password.

3. Create a `settings-dev.json` file at the app root containing:

```json
{
  "public": {
    "environment": "development"
  },
  "unsplash": {
    "accessKey": "<UNSPLASH_ACCESS_KEY>"
  },
  "packages": {
    "service-configuration": {
      "pitchly": {
        "loginStyle": "redirect",
        "clientId": "<PITCHLY_APP_ID>",
        "secret": "<PITCHLY_APP_SECRET>",
        "accessTokenScope": []
      }
    }
  }
}
```

> :lock: Paste the **App ID** and **App Secret** you received from step 1 into the `service-configuration` placeholders above. For the Unsplash access key, ask someone from the Pitchly team for the key and paste it in the `accessKey` field.

> :question: The `accessTokenScope` property defines the permissions of the access token saved in the user document. This access token is also exposed client-side. Since this app has permission to update data, but we don't know if the *user* should be able to update data, we empty the `accessTokenScope` to give the client-side read-only permission to Pitchly, and then we proxy all write requests to the server so that it can generate an access token with elevated permissions to write to the table.

4. Run:
```
npm start
```

The app should now be accessible at http://localhost:3000/

---

## A word on Git submodules

<details>
  <summary>Show details</summary>
  
  This app has several nested Git projects within it in the `packages` directory. To get updates for a submodule, `cd` to the specific package's directory and run `git pull`. This will get the latest updates for the package.
</details>

## If running the Pitchly platform locally

<details>
  <summary>Show details</summary>
  
  If running the platform locally, add the `platformOrigin` and `origin` properties to your `settings-dev.json` file:

  ```js
  {
    "public": {
      // other properties here...
      "platformOrigin": "http://localhost:3000"
    },
    "packages": {
      "service-configuration": {
        "pitchly": {
          // other properties here...
          "origin": "http://localhost:3000"
        }
      }
    }
  }
  ```

  You would also need to make sure the app is registered with your local version of the platform instead of the online version.

  You may also need to use a different command to run the app if the platform is already running on port `3000`. To run the app on port `3002`, you can run this:

  ```
  meteor --settings settings-dev.json --port 3002
  ```

  Then the app will be accessible at http://localhost:3002/ instead.
</details>