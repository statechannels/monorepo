import * as scenarios from "./scenarios";
import {addStoriesFromScenario as addStories} from "../../../../__stories__";
import {NewLedgerChannel} from "../container";

function flattenScenario(scenario) {
  Object.keys(scenario).forEach(key => {
    if (scenario[key].state) {
      scenario[key].state = scenario[key].state.state;
    }
  });
  return scenario;
}

addStories(flattenScenario(scenarios.happyPath), "Indirect Funding / Player A / Happy Path", NewLedgerChannel);
addStories(
  flattenScenario(scenarios.ledgerFundingFails),
  "Indirect Funding / Player A / Ledger funding fails",
  NewLedgerChannel
);
