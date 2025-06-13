const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

class WebSearchService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required in .env file');
    }
    
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro-preview-06-05' });
  }

  /**
   * Perform a web search using Gemini
   * @param {string} query - The search query
   * @param {Object} options - Search options
   * @param {number} options.maxResults - Maximum number of results to return
   * @param {string} options.timeRange - Time range for results (e.g., 'day', 'week', 'month', 'year')
   * @returns {Promise<Array>} Array of search results
   */
  async search(query, options = {}) {
    try {
      const { maxResults = 5, timeRange } = options;
      
      // Construct the search prompt
      let searchPrompt = `Search the web for: ${query}`;
      if (timeRange) {
        searchPrompt += ` (from the past ${timeRange})`;
      }
      searchPrompt += `\nReturn ${maxResults} most relevant results.`;

      // Generate search results
      const result = await this.model.generateContent(searchPrompt);
      const response = await result.response;
      const text = response.text();

      // Parse and format results
      const results = this.parseSearchResults(text);
      return results.slice(0, maxResults);
    } catch (error) {
      console.error('Error performing web search:', error);
      throw error;
    }
  }

  /**
   * Parse the raw search results text into structured data
   * @param {string} text - Raw search results text
   * @returns {Array} Array of structured search results
   */
  parseSearchResults(text) {
    const results = [];
    const lines = text.split('\n');

    let currentResult = null;
    for (const line of lines) {
      if (line.startsWith('Title:') || line.startsWith('Result:')) {
        if (currentResult) {
          results.push(currentResult);
        }
        currentResult = {
          title: line.replace(/^(Title:|Result:)\s*/, '').trim(),
          snippet: '',
          url: ''
        };
      } else if (line.startsWith('URL:') && currentResult) {
        currentResult.url = line.replace('URL:', '').trim();
      } else if (currentResult) {
        currentResult.snippet += line.trim() + ' ';
      }
    }

    if (currentResult) {
      results.push(currentResult);
    }

    return results;
  }

  /**
   * Get real-time information about a topic
   * @param {string} topic - The topic to get information about
   * @returns {Promise<Object>} Information about the topic
   */
  async getTopicInfo(topic) {
    try {
      const prompt = `Get the latest information about: ${topic}\nInclude key facts, recent developments, and current status.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      return {
        topic,
        information: text,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting topic info:', error);
      throw error;
    }
  }
}

module.exports = WebSearchService; 