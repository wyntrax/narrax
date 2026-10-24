# Environment-file discovery disabled

Vite 5 accepts an env directory, but not `envDir: false`. Both test configurations
point here instead of the repository or web root. Keep this directory free of env
files: verification uses only inherited process variables.
