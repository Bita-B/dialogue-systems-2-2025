import { assign, createActor, setup, fromPromise } from "xstate"; // fromPromise is to wrap async functions 
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";
import type { DMEvents, DMContext, Message } from "./types"; // msg [] 
import { KEY } from "./azure";
import { fetchChatCompletion } from "./ollama";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 10000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => 
      context.spstRef.send({ type: "PREPARE" }),
    sst_speak: ({ context, event }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: { utterance: (event as any).value || context.messages[context.messages.length - 1].content },
      }), // (event as any).value => if there is a value, use it 
    sst_listen: ({ context }) => 
      context.spstRef.send({ type: "LISTEN" }),
  },
  actors: {
    chatCompletion: fromPromise( // ollama API for response
      async ({ input }: { input: { messages: Message[] } }) => { // full conversation history
        const response = await fetchChatCompletion(input.messages); // calling from ollama
        return response; // output
      }),
  },
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: "",
    messages: [ // an extra role
      {
        role: "system", // how LLM acts
        content: "You are a voice assistant. You are very good at a lot of things. Keep your responses very brief please. Say 'That is all, sir.' after every text generation."
      },      
      {
        role: "assistant", // LLM's answ
        content: "Hello! How can I help you?"        
      }
    ],
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "Loop", // move 
      },
    },
    Loop: {
      initial: "Speaking",
      states: {
        Speaking: {
          entry: ({ context }) => { // get context
            const lastMessage = context.messages[context.messages.length - 1]; // last msg
            if (lastMessage.role === "assistant") { // system may speak
              context.spstRef.send({ // speak it 
                type: "SPEAK",
                value: { utterance: lastMessage.content },
              });
            }
          },
          on: {
            SPEAK_COMPLETE: "Ask", // move to state
          },
        },
        Ask: {
          entry: "sst_listen",
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => { // context updated
                const utterance = event.value[0]?.utterance || ""; // return part
                return {
                  lastResult: utterance,
                  messages: [ // update msg
                    ...context.messages, 
                    { role: "user" as const, content: utterance } 
                  ],
                };
              }),
            },
            LISTEN_COMPLETE: "ChatCompletion", // move to state
          },
        },
        ChatCompletion: {
          invoke: { // earlier act
            src: "chatCompletion",
            input: ({ context }) => ({ // go through convrs
              messages: context.messages, 
            }),
            onDone: {
              target: "Speaking", // go to speaking state
              actions: assign(({ context, event }) => ({ 
                messages: [ // assist answr
                  ...context.messages,
                  { role: "assistant" as const, content: event.output }
                ],
              })),
            },
            onError: { 
              target: "Speaking", 
              actions: assign(({ context }) => ({ // error msg 
                messages: [
                  ...context.messages,
                  { 
                    role: "assistant" as const, 
                    content: "I couldn't process that. Please say it again." 
                  }
                ],
              })),
            },
          },
        },
      },
    },
  },
});
const dmActor = createActor(dmMachine, {}).start();
dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("Messages:", state.context.messages); // 
  console.groupEnd();
});
export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta()
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
