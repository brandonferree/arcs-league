/**
 * Slash command definitions, registered on the league's server by
 * `npm run discord:register` (scripts/register-commands.ts).
 */

const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;

export const COMMANDS = [
  {
    name: "campaign",
    description: "ARCS League campaigns",
    type: 1,
    contexts: [0],
    options: [
      { type: SUB_COMMAND, name: "start", description: "Open a lobby for a new Blighted Reach campaign (3 or 4 players)" },
      { type: SUB_COMMAND, name: "status", description: "List the campaigns in progress" },
    ],
  },
  {
    name: "stats",
    description: "ARCS League statistics",
    type: 1,
    contexts: [0],
    options: [
      {
        type: SUB_COMMAND,
        name: "player",
        description: "A player's record in closed campaigns",
        options: [{ type: USER, name: "member", description: "Whose stats (default: you)", required: false }],
      },
      {
        type: SUB_COMMAND,
        name: "fate",
        description: "A fate's record in closed campaigns",
        options: [{ type: STRING, name: "name", description: "The fate", required: true, autocomplete: true }],
      },
    ],
  },
] as const;
