FROM circleci/node:10.16.3-browsers
USER root
ENV DISPLAY :99.0

RUN  apt-get install -y xvfb

WORKDIR /statechannels/monorepo

# Copy the necessary packages

COPY .env.* ./
COPY *.json ./
COPY yarn.lock ./
COPY ./packages/devtools packages/devtools/
COPY ./packages/e2e-tests packages/e2e-tests/
COPY ./packages/channel-provider packages/channel-provider/
COPY ./packages/client-api-schema packages/client-api-schema/

# Install dependencies
RUN yarn

WORKDIR /statechannels/monorepo/packages/e2e-tests

COPY ./packages/e2e-tests/persistent-seeder/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]