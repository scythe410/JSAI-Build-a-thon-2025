import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import ModelClient from "@azure-rest/ai-inference";
// import { AzureKeyCredential } from "@azure/core-auth";
// import { isUnexpected } from "@azure-rest/ai-inference";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

dotenv.config();

// Log environment variables (safely)
console.log('Environment check:');
console.log('AZURE_INFERENCE_SDK_ENDPOINT:', process.env.AZURE_INFERENCE_SDK_ENDPOINT ? '✓ Set' : '✗ Missing');
console.log('AZURE_INFERENCE_SDK_KEY:', process.env.AZURE_INFERENCE_SDK_KEY ? '✓ Set' : '✗ Missing');

const app = express();
app.use(cors());
app.use(express.json());

// **FIXED**: Corrected client initialization syntax by wrapping apiVersion in an object.
/*
const client = ModelClient(
    process.env.AZURE_INFERENCE_SDK_ENDPOINT,
    new AzureKeyCredential(process.env.AZURE_INFERENCE_SDK_KEY), {
        apiVersion: "2024-12-01-preview"
    }
);
*/

const chatModel = new AzureChatOpenAI({
    azureOpenAIApiKey: process.env.AZURE_INFERENCE_SDK_KEY,
    azureOpenAIApiInstanceName: process.env.INSTANCE_NAME, // In target url: https://<INSTANCE_NAME>.services...
    azureOpenAIApiDeploymentName: process.env.DEPLOYMENT_NAME, // i.e "gpt-4o"
    azureOpenAIApiVersion: "2024-12-01-preview", // In target url: ...<VERSION>
    temperature: 1,
    maxTokens: 4096,
  });

console.log('Client configuration:', {
    endpoint: process.env.AZURE_INFERENCE_SDK_ENDPOINT,
    apiVersion: "2024-12-01-preview"
});

// Set up session-based in-memory store
const sessionMemories = {};

// Add a helper function to get/create a session history
function getSessionMemory(sessionId) {
  if (!sessionMemories[sessionId]) {
    const history = new ChatMessageHistory();
    sessionMemories[sessionId] = new BufferMemory({
      chatHistory: history,
      returnMessages: true,
      memoryKey: "chat_history",
    });
  }
  return sessionMemories[sessionId];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const pdfPath = path.join(projectRoot, 'data/employee_handbook.pdf');

// PDF processing functionality
let pdfText = null;
let pdfChunks = [];
const CHUNK_SIZE = 800;

// **FIXED**: Rewritten function with proper async handling, error checking, and loop structure.
async function loadPDF() {
    // Prevent reloading if already loaded or if loading failed previously
    if (pdfText !== null) {
        return;
    }

    if (!fs.existsSync(pdfPath)) {
        console.error(`PDF file not found at path: ${pdfPath}`);
        pdfText = "PDF not found."; // Set state to avoid retries
        return;
    }

    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await pdfParse(dataBuffer);
        pdfText = data.text;
        let currentChunk = "";
        const words = pdfText.split(/\s+/);

        for (const word of words) {
            if ((currentChunk + " " + word).length <= CHUNK_SIZE) {
                currentChunk += (currentChunk ? " " : "") + word;
            } else {
                pdfChunks.push(currentChunk);
                currentChunk = word;
            }
        }

        // Add the last remaining chunk
        if (currentChunk) {
            pdfChunks.push(currentChunk);
        }
        console.log(`PDF loaded and split into ${pdfChunks.length} chunks.`);
    } catch (error) {
        console.error("Error processing PDF file:", error);
        pdfText = "Error processing PDF."; // Set state to avoid retries
    }
}

// **FIXED**: Added missing curly braces in the loop.
function retrieveRelevantContent(query) {
    const queryTerms = query.toLowerCase().split(/\s+/)
        .filter(term => term.length > 3)
        .map(term => term.replace(/[.,?!;:()"']/g, ""));

    if (queryTerms.length === 0) {
        return [];
    }

    const scoredChunks = pdfChunks.map(chunk => {
        const chunkLower = chunk.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
            const regex = new RegExp(term, 'gi');
            const matches = chunkLower.match(regex);
            if (matches) {
                score += matches.length;
            }
        }
        return {
            chunk,
            score
        };
    });

    return scoredChunks
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(item => item.chunk);
}

// **FIXED**: Completely restructured the route handler for clarity and correctness.
app.post("/chat", async (req, res) => {
    console.log("Received /chat request:", req.body);
    const userMessage = req.body.message;
    const useRAG = req.body.useRAG === undefined ? true : req.body.useRAG;
    const sessionId = req.body.sessionId || "default";

    let sources = [];

    const memory = getSessionMemory(sessionId);
    const memoryVars = await memory.loadMemoryVariables({});

    if (useRAG) {
        await loadPDF();
        sources = retrieveRelevantContent(userMessage);
    }

    // Prepare system prompt
    const systemMessage = useRAG
        ? {
            role: "system",
            content: sources.length > 0
                ? `You are a helpful assistant for Contoso Electronics. You must ONLY use the information provided below to answer.\n\n--- EMPLOYEE HANDBOOK EXCERPTS ---\n${sources.join('\n\n')}\n--- END OF EXCERPTS ---`
                : `You are a helpful assistant for Contoso Electronics. The excerpts do not contain relevant information for this question. Reply politely: "I'm sorry, I don't know. The employee handbook does not contain information about that."`,
        }
        : {
            role: "system",
            content: "You are a helpful and knowledgeable assistant. Answer the user's questions concisely and informatively.",
        };

    try {
        // Build final messages array
        const messages = [
            systemMessage,
            ...(memoryVars.chat_history || []),
            { role: "user", content: userMessage },
        ];

        console.log("Invoking chatModel...");
        const response = await chatModel.invoke(messages);
        console.log("Model response:", response);

        await memory.saveContext({ input: userMessage }, { output: response.content });

        res.json({ content: response.content, sources: useRAG ? sources : [] });
    } catch (err) {
        console.error("AI model error:", err);
        if (err && err.stack) {
            console.error("Stack trace:", err.stack);
        }
        res.status(500).json({
            error: "Model call failed",
            message: err.message,
            reply: "Sorry, I encountered an error. Please try again."
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
