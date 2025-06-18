import { LitElement, html } from 'lit';
import { loadMessages, saveMessages, clearMessages } from '../utils/chatStore.js';
import './chat.css'; // Import the CSS file

export class ChatInterface extends LitElement {
  static get properties() {
    return {
      messages: { type: Array },
      inputMessage: { type: String },
      isLoading: { type: Boolean },
      isRetrieving: { type: Boolean },
      ragEnabled: { type: Boolean }
    };
  }

  constructor() {
    super();
    // Initialize component state
    this.messages = [];
    this.inputMessage = '';
    this.isLoading = false;
    this.isRetrieving = false;
    this.ragEnabled = true; // Enable by default
  }

  // Render into light DOM so external CSS applies
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Load chat history from localStorage when component is added to the DOM
    this.messages = loadMessages();
  }

  updated(changedProps) {
    // Save chat history to localStorage whenever messages change
    if (changedProps.has('messages')) {
      saveMessages(this.messages);
    }
  }

  render() {
    return html`
    <div class="chat-container">
      <div class="chat-header">
        <button class="clear-cache-btn" @click=${this._clearCache}> 🧹Clear Chat</button>
        <label class="rag-toggle">
          <input type="checkbox" ?checked=${this.ragEnabled} @change=${this._toggleRag}>
          Use Employee Handbook
        </label>
      </div>
      <div class="chat-messages">
        ${this.messages.map(message => html`
          <div class="message ${message.role === 'user' ? 'user-message' : 'ai-message'}">
            <div class="message-content">
              <span class="message-sender">${message.role === 'user' ? 'You' : 'AI'}</span>
              <p>${message.content}</p>
              ${this.ragEnabled && message.sources && message.sources.length > 0 ? html`
                <details class="sources">
                  <summary>📚 Sources</summary>
                  <div class="sources-content">
                    ${message.sources.map(source => html`<p>${source}</p>`)}
                  </div>
                </details>
              ` : ''}
            </div>
          </div>
        `)}
        ${this.isRetrieving ? html`
          <div class="message system-message">
            <p>📚 Searching employee handbook...</p>
          </div>
        ` : ''}
        ${this.isLoading && !this.isRetrieving ? html`
          <div class="message ai-message">
            <div class="message-content">
              <span class="message-sender">AI</span>
              <p>Thinking...</p>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="chat-input">
        <input 
          type="text" 
          placeholder="Ask about company policies, benefits, etc..." 
          .value=${this.inputMessage}
          @input=${this._handleInput}
          @keyup=${this._handleKeyUp}
        />
        <button @click=${this._sendMessage} ?disabled=${this.isLoading || !this.inputMessage.trim()}>
          Send
        </button>
      </div>
    </div>
  `;
  }

  _toggleRag(e) {
    this.ragEnabled = e.target.checked;
  }

  _handleInput(e) {
    this.inputMessage = e.target.value;
  }

  _handleKeyUp(e) {
    if (e.key === 'Enter' && this.inputMessage.trim() && !this.isLoading) {
      this._sendMessage();
    }
  }

  async _sendMessage() {
  const message = this.inputMessage.trim();
  if (!message) return;
  
  this.messages = [...this.messages, { role: 'user', content: message }];
  this.inputMessage = '';
  this.isLoading = true;
  this.isRetrieving = this.ragEnabled;
  
  try {
    console.log('Sending message:', message); // Add this
    const data = await this._apiCall(message);
    console.log('Received response:', data); // Add this
    
    this.isRetrieving = false;
    this.isLoading = false;
    
    if (data && data.content) {
      this.messages = [
        ...this.messages,
        {
          role: 'ai',
          content: data.content,
          sources: data.sources || []
        }
      ];
    } else {
      console.error('Invalid response structure:', data); // Add this
      this.messages = [
        ...this.messages,
        { role: 'ai', content: 'Sorry, I encountered an error. Please try again.' }
      ];
    }
  } catch (err) {
    console.error('Error in _sendMessage:', err); // Improve this
    this.isRetrieving = false;
    this.isLoading = false;
    this.messages = [
      ...this.messages,
      { role: 'ai', content: 'Sorry, I encountered an error. Please try again.' }
    ];
  }
}

  async _apiCall(message) {
  const res = await fetch("http://localhost:3001/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      message,
      useRAG: this.ragEnabled 
    }),
  });
  
  // Check if the response is successful
  if (!res.ok) {
    console.error('HTTP Error:', res.status, res.statusText);
    const errorText = await res.text();
    console.error('Error response:', errorText);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  
  const data = await res.json();
  console.log('Received data:', data); // Add this for debugging
  return data;
}

  _clearCache() {
    this.messages = [];
  }

  static styles = css`
    /* Add your styles here */
  `;
}

// Fixed: Changed from ChatComponent to ChatInterface to match the class name
customElements.define('chat-interface', ChatInterface);