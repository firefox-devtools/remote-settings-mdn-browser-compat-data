# `@mdn/browser-compat-data` -> RemoteSettings 

Data from [MDN compatibility data](https://github.com/mdn/browser-compat-data) are used in the compatibility panel of Firefox DevTools.
The script from this repo consumes the data published in the `@mdn/browser-compat-data` NPM package and update the associated collections in RemoteSettings:
- `devtools-compatibility-browsers`: The list of non-retired browsers, extracted from [https://github.com/mdn/browser-compat-data/tree/master/browsers](https://github.com/mdn/browser-compat-data/tree/master/browsers)
- TODO: The list of CSS properties compatibility data, extracted from ([https://github.com/mdn/browser-compat-data/tree/master/css](https://github.com/mdn/browser-compat-data/tree/master/css)

When running the script, logs are emitted to stdout indicate if the collection was updated, and if so, provide a short summary of the modifications, and ultimately ask for a data review of those changes (unless `ENVIRONMENT` is set to `dev`, in which case changes are automatically published)
