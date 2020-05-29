export type ErrorCodes = {
  EnableEthereum: {
    EthereumNotEnabled: 100;
  };
  CloseAndWithdraw: {
    UserDeclined: 200;
  };
  CloseChannel: {
    NotYourTurn: 300;
    ChannelNotFound: 301;
  };
  UpdateChannel: {
    ChannelNotFound: 400;
    InvalidTransition: 401;
    InvalidAppData: 402;
    NotYourTurn: 403;
    ChannelClosed: 403;
  };
};
