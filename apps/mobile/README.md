# Helping Hand mobile

Expo 54 recipient app for phones and Meta glasses. Native development uses an Expo development
build because the wearable integration is not available in Expo Go or on the web.

## Setup

From the repository root:

```sh
bun install
cp apps/mobile/.env.example apps/mobile/.env.local
```

Set `META_APP_ID` and `META_CLIENT_TOKEN` in `.env.local` before building the wearable flow. Android
builds also need `GITHUB_ACTOR` and `GITHUB_TOKEN` to download Meta's Maven packages. The production
API is the default; set `EXPO_PUBLIC_API_ORIGIN` to use a local or preview Worker.

Create and run a local development build:

```sh
cd apps/mobile
bun run ios
# or: bun run android
```

After the development build is installed, use `bun run start` for normal JavaScript changes.

For a browser-only layout preview, use `bun run web`. Wearable APIs must be tested in a native
development build.

## EAS builds

Connect the app to an Expo project once:

```sh
bunx eas-cli init
```

Then create an installable development build with `bunx eas-cli build --profile development`.
Store the Meta and GitHub values from `.env.example` in the EAS environment before running cloud
builds.

## Checks

```sh
bun run lint
bun run typecheck
bun run doctor
bun run export:web
```

With Bun's isolated workspace install, Expo Doctor currently reports same-version Expo packages as
duplicates. SDK 54 supports isolated installs, and `autolinkingModuleResolution` is enabled in the
app config so Metro and native autolinking resolve the same copies.
