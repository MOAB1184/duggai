const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeCache = require('node-cache');
const cosineSimilarity = require('compute-cosine-similarity');
const crypto = require('crypto');

class EmbeddingService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'embedding-001' });
        this.cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour
    }

    async generateEmbedding(text) {
        const cacheKey = this._hashContent(text);
        
        // Check cache first
        const cachedEmbedding = this.cache.get(cacheKey);
        if (cachedEmbedding) {
            return cachedEmbedding;
        }

        try {
            const result = await this.model.embedContent(text);
            const embedding = result.embedding;
            
            // Cache the embedding
            this.cache.set(cacheKey, embedding);
            
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw error;
        }
    }

    async generateEmbeddings(texts) {
        const embeddings = [];
        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }

    async findSimilar(query, texts, k = 5) {
        const queryEmbedding = await this.generateEmbedding(query);
        const textEmbeddings = await this.generateEmbeddings(texts);
        // Ensure we always pass arrays of numbers to cosineSimilarity
        const getArray = (emb) => Array.isArray(emb) ? emb : (emb && Array.isArray(emb.embedding) ? emb.embedding : []);
        const queryArr = getArray(queryEmbedding);
        const similarities = textEmbeddings.map((embedding, index) => ({
            text: texts[index],
            similarity: cosineSimilarity(queryArr, getArray(embedding))
        }));
        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, k);
    }

    _hashContent(content) {
        return crypto
            .createHash('sha256')
            .update(content)
            .digest('hex');
    }

    clearCache() {
        this.cache.flushAll();
    }
}

module.exports = EmbeddingService; 