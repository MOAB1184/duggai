const WebSocket = require('ws');

class LSPClient {
  constructor(port = 3000) {
    this.port = port;
    this.ws = null;
    this.connected = false;
    this.messageQueue = [];
    this.messageHandlers = new Map();
    this.nextRequestId = 1;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectTimeout = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Clean up any existing connection
        this.cleanup();

        this.ws = new WebSocket(`ws://localhost:${this.port}`);

        this.ws.on('open', async () => {
          console.log('Connected to LSP server');
          this.connected = true;
          this.reconnectAttempts = 0;
          
          try {
            // Initialize LSP connection
            const response = await this.sendRequest('initialize', {
              processId: process.pid,
              rootUri: null,
              capabilities: {
                textDocument: {
                  completion: {
                    completionItem: {
                      snippetSupport: true
                    }
                  },
                  hover: {
                    contentFormat: ['markdown']
                  }
                }
              }
            });

            // Send initialized notification
            await this.sendNotification('initialized', {});
            
            // Process queued messages
            while (this.messageQueue.length > 0) {
              const message = this.messageQueue.shift();
              this.ws.send(JSON.stringify(message));
            }

            resolve(response);
          } catch (error) {
            console.error('Error during LSP initialization:', error);
            reject(error);
          }
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            
            if (message.id && this.messageHandlers.has(message.id)) {
              const { resolve, reject } = this.messageHandlers.get(message.id);
              this.messageHandlers.delete(message.id);
              
              if (message.error) {
                reject(new Error(message.error.message));
              } else {
                resolve(message.result);
              }
            }
          } catch (error) {
            console.error('Error handling LSP message:', error);
          }
        });

        this.ws.on('error', (error) => {
          console.error('LSP WebSocket error:', error);
          this.connected = false;
          this.attemptReconnect();
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('Disconnected from LSP server');
          this.connected = false;
          this.attemptReconnect();
        });
      } catch (error) {
        console.error('Error connecting to LSP server:', error);
        reject(error);
      }
    });
  }

  async disconnect() {
    try {
      // Clear reconnect timeout
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Close WebSocket connection
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Clear message handlers
      for (const [id, { reject }] of this.messageHandlers) {
        reject(new Error('LSP client disconnected'));
      }
      this.messageHandlers.clear();

      // Clear message queue
      this.messageQueue = [];

      this.connected = false;
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Error disconnecting from LSP server:', error);
    }
  }

  async cleanup() {
    await this.disconnect();
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect to LSP server (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.reconnectTimeout = setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    } else {
      console.log('Max reconnect attempts reached. LSP features will be limited.');
    }
  }

  async sendRequest(method, params) {
    const id = this.nextRequestId++;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.messageHandlers.set(id, { resolve, reject });

      if (this.connected) {
        this.ws.send(JSON.stringify(message));
      } else {
        this.messageQueue.push(message);
      }
    });
  }

  async sendNotification(method, params) {
    const message = {
      jsonrpc: '2.0',
      method,
      params
    };

    if (this.connected) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  // Document synchronization methods
  async didOpen(uri, version, text) {
    await this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        version,
        text
      }
    });
  }

  async didChange(uri, version, changes) {
    await this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri,
        version
      },
      contentChanges: changes
    });
  }

  async didClose(uri) {
    await this.sendNotification('textDocument/didClose', {
      textDocument: { uri }
    });
  }

  // LSP feature methods
  async getCompletions(uri, position) {
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position
    });
  }

  async getDefinition(uri, position) {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position
    });
  }

  async getReferences(uri, position) {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position
    });
  }

  async getHover(uri, position) {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position
    });
  }

  async getSignatureHelp(uri, position) {
    return this.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri },
      position
    });
  }

  async getContext() {
    return {
      connected: this.connected,
      messageQueueSize: this.messageQueue.length,
      activeRequests: this.messageHandlers.size
    };
  }
}

module.exports = LSPClient; 