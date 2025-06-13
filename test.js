const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const models = await genAI.getGenerativeModel({ model: "gemini-2.5-pro" }).listModels();
    console.log("Available models:", models.map(m => m.name));
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();