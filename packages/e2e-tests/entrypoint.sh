#!/bin/sh

# Startup Xvfb
Xvfb -ac :99 -screen 0 1280x1024x16 > /dev/null 2>&1 &

# Export some variables
export DISPLAY=:99.0
export PUPPETEER_EXEC_PATH="google-chrome-stable"

#!/bin/sh
cd packages/e2e-tests

set -e
exec "$@"
