/**
 * TreatInk Personalization SDK
 * Version: 1.2.0
 * 
 * Embed this script on your product pages to enable TreatInk personalization
 * Optimized for Cloudflare Worker deployment
 * 
 * Usage:
 * <script src="https://sdk.treatink.com/treatink-sdk.js"></script>
 * <script>
 *   TreatInk.init({
 *     platform: 'shopify',
 *     productId: '{{ product.id }}',
 *     apiKey: 'your-api-key',
 *     environment: 'production' // or 'sandbox'
 *   });
 * </script>
 * 
 * On Order Confirmation Page:
 * <script>
 *   TreatInk.init({...});
 *   TreatInk.confirmOrder({
 *     orderId: '{{ order.id }}',
 *     customerEmail: '{{ customer.email }}',
 *     total: {{ total_price | money_without_currency }}
 *   });
 * </script>
 */

(function(window, document) {
  'use strict';

  // Configuration - Supabase edge function endpoints
  const TREATINK_CONFIG = {
    production: {
      baseUrl: 'https://treatink.com',
      supabaseUrl: 'https://api.treatink.com', // Replace with actual Supabase URL
      customizeUrl: 'https://treatink.com/customizer'
    },
    sandbox: {
      baseUrl: 'https://staging.treatink.com',
      supabaseUrl: 'https://api.treatink.com',
      customizeUrl: 'https://staging.treatink.com/customizer'
    }
  };

  const STORAGE_KEY = 'treatink_personalizations';
  const MODAL_ID = 'treatink-personalization-modal';

  /**
   * Main TreatInk SDK Object
   */
  const TreatInk = {
    config: null,
    initialized: false,
    hostname: null,
    environment: 'production',

    /**
     * Initialize the SDK
     */
    init: function(options) {
      if (this.initialized) {
        console.warn('[TreatInk SDK] Already initialized');
        return;
      }

      // Validate required options
      if (!options.platform || !options.productId) {
        console.error('[TreatInk SDK] ERROR: platform and productId are required');
        return false;
      }

      if (!options.apiKey) {
        console.warn('[TreatInk SDK] WARNING: apiKey not provided. API calls will fail.');
      }

      // Detect hostname automatically
      this.hostname = window.location.hostname;
      this.environment = options.environment || 'production';
      
      console.log(`[TreatInk SDK] Initializing for ${this.environment} environment`);
      console.log(`[TreatInk SDK] Detected hostname: ${this.hostname}`);

      this.config = {
        platform: options.platform.toLowerCase(),
        productId: String(options.productId),
        apiKey: options.apiKey || null,
        environment: this.environment,
        customizeButtonText: options.customizeButtonText || 'Personalize This Product',
        customizeButtonClass: options.customizeButtonClass || 'treatink-personalize-btn',
        addToCartSelector: options.addToCartSelector || this._getDefaultAddToCartSelector(options.platform),
        onPersonalizationComplete: options.onPersonalizationComplete || null,
        onPersonalizationClose: options.onPersonalizationClose || null,
        debug: options.debug || false
      };

      this.initialized = true;

      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this._setup());
      } else {
        this._setup();
      }

      return true;
    },

    /**
     * Setup the personalization button and modal
     */
    _setup: function() {
      this._injectStyles();
      this._injectPersonalizeButton();
      this._createModal();
      this._setupEventListeners();
      
      // Check for existing personalization
      const existingSession = this._getPersonalizationSession();
      if (existingSession && existingSession.customized) {
        this._updateButtonState(true);
      }

      this._log('SDK setup complete');
    },

    /**
     * Get default add to cart selector based on platform
     */
    _getDefaultAddToCartSelector: function(platform) {
      const selectors = {
        'shopify': '[name="add"], .product-form__submit, button[type="submit"][name="add"]',
        'woocommerce': '.single_add_to_cart_button',
        'bigcommerce': '.add-to-cart-button, #form-action-addToCart',
        'custom': '[data-add-to-cart], .add-to-cart'
      };
      return selectors[platform.toLowerCase()] || selectors.custom;
    },

    /**
     * Inject CSS styles
     */
    _injectStyles: function() {
      const styles = `
        .treatink-personalize-btn {
          display: inline-block;
          padding: 12px 24px;
          margin-bottom: 12px;
          background-color: #FFA518;
          color: #0D1221;
          border: none;
          border-radius: 6px;
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-align: center;
          width: 100%;
          max-width: 400px;
          box-sizing: border-box;
        }

        .treatink-personalize-btn:hover {
          background-color: #EA8D00;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(255, 165, 24, 0.3);
        }

        .treatink-personalize-btn:active {
          transform: translateY(0);
        }

        .treatink-personalize-btn.personalized {
          background-color: #8BEA06;
          color: #0D1221;
        }

        .treatink-personalize-btn.personalized::before {
          content: "✓ ";
          margin-right: 4px;
        }

        .treatink-personalize-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none !important;
        }

        .treatink-modal-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(13, 18, 33, 0.85);
          z-index: 999999;
          justify-content: center;
          align-items: center;
          animation: treatinkFadeIn 0.3s ease;
        }

        .treatink-modal-overlay.active {
          display: flex;
        }

        .treatink-modal-content {
          position: relative;
          width: 95%;
          max-width: 1200px;
          height: 90vh;
          background: #FFFDFB;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          animation: treatinkSlideUp 0.3s ease;
          overflow: hidden;
        }

        .treatink-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          background: #8BEA06;
          border-radius: 12px 12px 0 0;
        }

        .treatink-modal-title {
          font-family: 'Mitr', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 24px;
          font-weight: 600;
          color: #0D1221;
          margin: 0;
        }

        .treatink-modal-close {
          background: none;
          border: none;
          font-size: 32px;
          color: #0D1221;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .treatink-modal-close:hover {
          opacity: 0.7;
        }

        .treatink-modal-iframe {
          width: 100%;
          height: calc(100% - 64px);
          border: none;
          border-radius: 0 0 12px 12px;
        }

        .treatink-modal-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .treatink-modal-loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #FFA518;
          border-top-color: transparent;
          border-radius: 50%;
          animation: treatinkSpin 0.8s linear infinite;
          margin: 0 auto 16px;
        }

        @keyframes treatinkFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes treatinkSlideUp {
          from { 
            opacity: 0;
            transform: translateY(50px);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes treatinkSpin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
          .treatink-modal-content {
            width: 98%;
            height: 95vh;
          }
          
          .treatink-modal-title {
            font-size: 18px;
          }
        }
      `;

      const styleSheet = document.createElement('style');
      styleSheet.textContent = styles;
      styleSheet.setAttribute('id', 'treatink-styles');
      document.head.appendChild(styleSheet);
    },

    /**
     * Inject personalize button above add to cart
     */
    _injectPersonalizeButton: function() {
      const addToCartButton = document.querySelector(this.config.addToCartSelector);
      
      if (!addToCartButton) {
        console.warn(`[TreatInk SDK] Add to cart button not found with selector: ${this.config.addToCartSelector}`);
        return;
      }

      // Create personalize button
      const personalizeBtn = document.createElement('button');
      personalizeBtn.type = 'button';
      personalizeBtn.className = this.config.customizeButtonClass;
      personalizeBtn.textContent = this.config.customizeButtonText;
      personalizeBtn.setAttribute('data-treatink-personalize', 'true');

      // Insert before add to cart button
      addToCartButton.parentNode.insertBefore(personalizeBtn, addToCartButton);

      // Add click handler
      personalizeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openCustomizer();
      });

      this._log('Personalize button injected');
    },

    /**
     * Create modal container
     */
    _createModal: function() {
      const modalHTML = `
        <div id="${MODAL_ID}" class="treatink-modal-overlay">
          <div class="treatink-modal-content">
            <div class="treatink-modal-header">
              <h2 class="treatink-modal-title">Personalize Your Product</h2>
              <button class="treatink-modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="treatink-modal-loading">
              <div class="treatink-modal-loading-spinner"></div>
              <p>Loading customizer...</p>
            </div>
            <iframe class="treatink-modal-iframe" id="treatink-iframe" style="display:none;" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation" allow="camera; microphone"></iframe>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);
    },

    /**
     * Setup event listeners
     */
    _setupEventListeners: function() {
      const modal = document.getElementById(MODAL_ID);
      if (!modal) {
        console.error('[TreatInk SDK] Modal not found');
        return;
      }
      
      const closeBtn = modal.querySelector('.treatink-modal-close');
      
      // Close button
      closeBtn.addEventListener('click', () => this.closeCustomizer());

      // Click outside modal
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeCustomizer();
        }
      });

      // Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
          this.closeCustomizer();
        }
      });

      // Listen for messages from iframe
      window.addEventListener('message', (e) => this._handleIframeMessage(e));

      // Intercept add to cart to include personalization data
      this._interceptAddToCart();
    },

    /**
     * Open customizer modal
     */
    openCustomizer: async function() {
      const modal = document.getElementById(MODAL_ID);
      const iframe = document.getElementById('treatink-iframe');
      const loading = modal.querySelector('.treatink-modal-loading');
      const btn = document.querySelector('[data-treatink-personalize]');
      
      if (!modal || !iframe) {
        console.error('[TreatInk SDK] Modal elements not found');
        return;
      }

      // Disable button
      if (btn) btn.disabled = true;
      
      // Show modal with loading state
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      iframe.style.display = 'none';
      if (loading) loading.style.display = 'block';

      try {
        // Get or create session
        let sessionData = this._getPersonalizationSession();
        
        if (!sessionData || !sessionData.uuid) {
          // Create new session via API
          sessionData = await this._createPersonalizationSession();
        }

        // Build iframe URL with all necessary parameters
        const customizeUrl = TREATINK_CONFIG[this.config.environment].customizeUrl;
        const params = new URLSearchParams({
          apiMode: 'true',
          uuid: sessionData.uuid,
          platform: this.config.platform,
          productId: this.config.productId,
          hostname: this.hostname,
          environment: this.config.environment
        });
        
        const iframeUrl = `${customizeUrl}?${params.toString()}`;
        
        this._log(`Opening customizer: ${iframeUrl}`);
        
        iframe.src = iframeUrl;
        
        // Show iframe when loaded
        iframe.onload = () => {
          if (loading) loading.style.display = 'none';
          iframe.style.display = 'block';
        };

        // Timeout for iframe load
        const loadTimeout = setTimeout(() => {
          if (loading && loading.style.display !== 'none') {
            console.warn('[TreatInk SDK] Iframe load timeout');
            if (loading) loading.style.display = 'none';
            iframe.style.display = 'block';
          }
        }, 10000);

        iframe.addEventListener('load', () => clearTimeout(loadTimeout), { once: true });

      } catch (error) {
        console.error('[TreatInk SDK] Error opening customizer:', error);
        alert('Failed to load personalization tool. Please try again.');
        this.closeCustomizer();
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    /**
     * Close customizer modal
     */
    closeCustomizer: function() {
      const modal = document.getElementById(MODAL_ID);
      const iframe = document.getElementById('treatink-iframe');
      
      if (!modal) return;

      modal.classList.remove('active');
      document.body.style.overflow = '';
      
      // Clear iframe src to stop any ongoing processes
      if (iframe) iframe.src = 'about:blank';

      if (this.config.onPersonalizationClose) {
        this.config.onPersonalizationClose();
      }

      this._log('Customizer closed');
    },

    /**
     * Create new personalization session via API
     */
    _createPersonalizationSession: async function() {
      try {
        const supabaseUrl = TREATINK_CONFIG[this.config.environment].supabaseUrl;
        const endpoint = `${supabaseUrl}/functions/v1/create-personalization-session`;
        
        this._log(`Creating session via: ${endpoint}`);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.config.apiKey ? `Bearer ${this.config.apiKey}` : ''
          },
          body: JSON.stringify({
            platform: this.config.platform,
            salesChannelHostname: this.hostname,
            externalProductId: this.config.productId
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.sessionUuid) {
          throw new Error('Invalid response: missing sessionUuid');
        }

        const session = {
          uuid: data.sessionUuid,
          productId: this.config.productId,
          platform: this.config.platform,
          hostname: this.hostname,
          createdAt: new Date().toISOString(),
          customized: false
        };

        this._savePersonalizationSession(session);
        this._log('Session created:', session.uuid);
        return session;
        
      } catch (error) {
        console.error('[TreatInk SDK] Error creating session:', error);
        throw error;
      }
    },

    /**
     * Handle messages from iframe
     */
    _handleIframeMessage: function(event) {
      // Verify origin - allow both production and sandbox URLs
      const allowedOrigins = [
        'https://treatink.com',
        'https://sandbox.treatink.com',
        'http://localhost:5173', // Vite dev
        'http://localhost:3000',  // React dev
        'http://localhost:8080'   // Generic dev
      ];
      
      const isAllowedOrigin = allowedOrigins.some(origin => {
        return event.origin === origin || event.origin.startsWith(origin);
      });

      if (!isAllowedOrigin) {
        this._log(`Blocked message from unauthorized origin: ${event.origin}`, 'warn');
        return;
      }

      const data = event.data;
      
      if (!data || !data.type) {
        return;
      }

      this._log(`Received message: ${data.type}`);

      if (data.type === 'treatink_personalization_complete') {
        // Update session with customization data
        this._updatePersonalizationSession(data.payload);
        
        // Update button state
        this._updateButtonState(true);
        
        // Close modal
        this.closeCustomizer();

        if (this.config.onPersonalizationComplete) {
          this.config.onPersonalizationComplete(data.payload);
        }
      } else if (data.type === 'treatink_personalization_cancel') {
        this._log('User cancelled personalization');
        this.closeCustomizer();
      } else if (data.type === 'treatink_close_modal') {
        this.closeCustomizer();
      } else if (data.type === 'treatink_personalization_error') {
        console.error('[TreatInk SDK] Personalization error:', data.error);
        alert('An error occurred: ' + data.error);
        this.closeCustomizer();
      }
    },

    /**
     * Get personalization session from localStorage
     */
    _getPersonalizationSession: function() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;

        const sessions = JSON.parse(stored);
        return sessions[this.config.productId] || null;
      } catch (e) {
        console.error('[TreatInk SDK] Error reading personalization data:', e);
        return null;
      }
    },

    /**
     * Save personalization session to localStorage
     */
    _savePersonalizationSession: function(session) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const sessions = stored ? JSON.parse(stored) : {};
        sessions[this.config.productId] = session;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        this._log('Session saved to localStorage');
      } catch (e) {
        console.error('[TreatInk SDK] Error saving personalization data:', e);
      }
    },

    /**
     * Update personalization session
     */
    _updatePersonalizationSession: function(data) {
      const session = this._getPersonalizationSession();
      if (!session) return;

      session.customized = true;
      session.customizationData = data;
      session.updatedAt = new Date().toISOString();

      this._savePersonalizationSession(session);
      this._log('Session updated with customization data');
    },

    /**
     * Update button state
     */
    _updateButtonState: function(personalized) {
      const btn = document.querySelector('[data-treatink-personalize]');
      if (!btn) return;

      if (personalized) {
        btn.classList.add('personalized');
        btn.textContent = '✓ Edit Personalization';
        this._log('Button state: personalized');
      } else {
        btn.classList.remove('personalized');
        btn.textContent = this.config.customizeButtonText;
        this._log('Button state: not personalized');
      }
    },

    /**
     * Intercept add to cart to include personalization UUID
     */
    _interceptAddToCart: function() {
      const addToCartButton = document.querySelector(this.config.addToCartSelector);
      if (!addToCartButton) return;

      const form = addToCartButton.closest('form');
      if (!form) return;

      form.addEventListener('submit', (e) => {
        const session = this._getPersonalizationSession();
        if (!session || !session.customized) {
          this._log('No personalization to add to cart');
          return;
        }

        // Add personalization UUID to cart
        this._addPersonalizationToCart(form, session);
      });

      this._log('Add to cart interceptor installed');
    },

    /**
     * Add personalization data to cart
     */
    _addPersonalizationToCart: function(form, session) {
      const personalizationData = {
        uuid: session.uuid,
        productId: this.config.productId,
        hostname: this.hostname,
        timestamp: new Date().toISOString()
      };

      // Platform-specific implementations
      if (this.config.platform === 'shopify') {
        this._addToShopifyCart(form, personalizationData);
      } else if (this.config.platform === 'woocommerce') {
        this._addToWooCommerceCart(form, personalizationData);
      } else {
        this._addToGenericCart(form, personalizationData);
      }

      this._log('Personalization added to cart');
    },

    /**
     * Add to Shopify cart
     */
    _addToShopifyCart: function(form, data) {
      const personalizationNote = `TreatInk-UUID:${data.uuid}|ProductID:${data.productId}|Hostname:${data.hostname}`;
      
      // Try to find or create note field
      let noteInput = form.querySelector('input[name="note"], textarea[name="note"]');
      
      if (noteInput) {
        const existingNote = noteInput.value;
        noteInput.value = existingNote ? `${existingNote}\n${personalizationNote}` : personalizationNote;
      } else {
        // Create hidden note input
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'note';
        input.value = personalizationNote;
        form.appendChild(input);
      }

      this._log('Added to Shopify cart note:', personalizationNote);
    },

    /**
     * Add to WooCommerce cart
     */
    _addToWooCommerceCart: function(form, data) {
      // WooCommerce uses custom attributes
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'treatink_uuid';
      input.value = data.uuid;
      form.appendChild(input);

      this._log('Added to WooCommerce cart attributes');
    },

    /**
     * Add to generic platform cart
     */
    _addToGenericCart: function(form, data) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'treatink_personalization';
      input.value = JSON.stringify(data);
      form.appendChild(input);

      this._log('Added to generic cart data');
    },

    /**
     * Get all personalizations for checkout
     */
    getAllPersonalizations: function() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : {};
      } catch (e) {
        console.error('[TreatInk SDK] Error reading personalizations:', e);
        return {};
      }
    },

    /**
     * Clear personalization data (after order completion)
     */
    clearPersonalizations: function() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        this._log('Personalizations cleared from localStorage');
      } catch (e) {
        console.error('[TreatInk SDK] Error clearing personalizations:', e);
      }
    },

    /**
     * Send order confirmation to TreatInk
     */
    confirmOrder: async function(orderData) {
      if (!this.config.apiKey) {
        console.error('[TreatInk SDK] API key required for order confirmation');
        return null;
      }

      const personalizations = this.getAllPersonalizations();
      const personalizedItems = Object.values(personalizations)
        .filter(p => p.customized)
        .map(p => ({
          uuid: p.uuid,
          productId: p.productId
        }));

      if (personalizedItems.length === 0) {
        this._log('No personalizations to confirm');
        return null;
      }

      try {
        const supabaseUrl = TREATINK_CONFIG[this.config.environment].supabaseUrl;
        const endpoint = `${supabaseUrl}/functions/v1/external-order`;
        
        this._log(`Confirming order via: ${endpoint}`);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            platform: this.config.platform,
            externalOrderId: orderData.orderId,
            customerEmail: orderData.customerEmail,
            personalizations: personalizedItems,
            orderData: orderData
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        this._log('Order confirmed:', result);
        
        // Clear personalizations after successful confirmation
        this.clearPersonalizations();
        
        return result;
      } catch (error) {
        console.error('[TreatInk SDK] Error confirming order:', error);
        throw error;
      }
    },

    /**
     * Internal logging (respects debug flag)
     */
    _log: function(message, level = 'log') {
      if (!this.config || !this.config.debug) {
        return;
      }
      
      const timestamp = new Date().toLocaleTimeString();
      const prefix = `[TreatInk SDK ${timestamp}]`;
      
      if (level === 'warn') {
        console.warn(prefix, message);
      } else if (level === 'error') {
        console.error(prefix, message);
      } else {
        console.log(prefix, message);
      }
    }
  };

  // Expose TreatInk to global scope
  window.TreatInk = TreatInk;

})(window, document);
