import type { Message } from "./types";

/*
export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};

system - initial instructions for the LLM
user - what we say
assistant - what the AI responds
  
*/

const OLLAMA_API_URL = "http://localhost:11434/api/chat"; // ssh -f -N -p 62266 -L 11434:127.0.0.1:11434 gusbolbi@mltgpu.flov.gu.se

export async function fetchChatCompletion(messages: Message[]): Promise<string> { 
  console.log("Calling Ollama with messages:", messages); // debug log
  
  try { // wrapping api call in error handling
    const response = await fetch(OLLAMA_API_URL, { // http req
      method: "POST", // send actual data 
      headers: {
        "Content-Type": "application/json", // send json data
      },
      body: JSON.stringify({ 
        model: "llama3.2:latest", // "http://localhost:11434/api/tags" 
        messages: messages, // history
        stream: false, // get response
      }),
    });

	// error 
    if (!response.ok) { // if an error happens
      const errorText = await response.text(); 
      console.error("Ollama API error:", response.status, errorText); 
      throw new Error(`Ollama API error: ${response.status}`); 
    }

    const data = await response.json(); 
    console.log("Ollama response:", data);
    
    const assistantMessage = data.message.content;
    return assistantMessage;
    
    
    // maybe an error
    
  } catch (error) {
    console.error("Error calling Ollama:", error);
    return "Error while connecting to the language model. Probably ssh tunnel is not active.";
  }
}
