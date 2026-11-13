# @collabcode/config
Shared tsconfig bases (`tsconfig/base|node|react.json`), ESLint flat config (`eslint.config.js`), and Prettier config (`prettier.config.js`). Every app re-exports these from its own `eslint.config.js` / `prettier.config.js` and extends the tsconfig base by relative path.
