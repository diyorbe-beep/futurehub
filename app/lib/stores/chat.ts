import { map } from 'nanostores';

export const chatStore = map({
  started: false,
  aborted: false,
  showChat: true,

  /** When true, chat stream still runs but parsing/workbench updates are frozen until resumed */
  streamPaused: false,
});
