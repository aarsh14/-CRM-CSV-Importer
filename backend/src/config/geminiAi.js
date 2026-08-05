

import { ai } from "../services/geminiService";

const interaction = await ai.interactions.create({
  model: "gemini-3.5-flash",
  input: "Explain how AI works in a few words",
});
console.log(interaction.output_text);