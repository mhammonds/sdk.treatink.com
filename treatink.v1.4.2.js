/**
 * TreatInk Personalization SDK
 * Version: 1.4.2
 * 
 * Embed this script on your product pages to enable TreatInk personalization
 * Optimized for Cloudflare Worker deployment
 * 
 * New in 1.4.0:
 * - petTypes option to filter pet selection (dog-only, cat-only, or both)
 * - Auto-add to cart after personalization saves
 * - Auto-redirect to cart page
 * - Artwork URL stored as line item property for cart display
 * 
 * New in 1.4.2:
 * - Session cleared after add-to-cart, allowing multiple personalizations
 * 
 * Usage:
 * <script src="https://sdk.treatink.com/treatink.v1.4.2.js"></script>
 * <script>
 *   TreatInk.init({
 *     platform: 'shopify',
 *     productId: '{{ product.id }}',
 *     apiKey: 'your-api-key',
 *     environment: 'production',
 *     buttonColor: '#f476b5',    // Optional: customize button color
 *     headerColor: '#f52b7d',    // Optional: customize modal header color
 *     petTypes: ['dog']          // Optional: filter pet types - ['dog'], ['cat'], or ['dog', 'cat']
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
      supabaseUrl: 'https://api.treatink.com',
      customizeUrl: 'https://treatink.com/customizer'
    },
    sandbox: {
      baseUrl: 'https://staging.treatink.com',
      supabaseUrl: 'https://api.treatink.com',
      customizeUrl: 'https://staging.treatink.com/customizer'
    }
  };

  // Default colors
  const DEFAULT_BUTTON_COLOR = '#EA8000';
  const DEFAULT_HEADER_COLOR = '#EA8000';

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
        personalizeButtonInsertBefore: options.personalizeButtonInsertBefore || null,
        addToCartSelector: options.addToCartSelector || this._getDefaultAddToCartSelector(options.platform),
        onPersonalizationComplete: options.onPersonalizationComplete || null,
        onPersonalizationClose: options.onPersonalizationClose || null,
        debug: options.debug || false,
        // Color customization options
        buttonColor: options.buttonColor || DEFAULT_BUTTON_COLOR,
        headerColor: options.headerColor || DEFAULT_HEADER_COLOR,
        // Pet type filtering - array of allowed types: ['dog'], ['cat'], or ['dog', 'cat']
        petTypes: options.petTypes || ['dog', 'cat']
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

      // Handle back-forward cache (bfcache) - recheck session when page is restored
      const self = this;
      window.addEventListener('pageshow', function(event) {
        if (event.persisted) {
          // Page was restored from bfcache - recheck session state
          self._log('Page restored from bfcache, rechecking session');
          const session = self._getPersonalizationSession();
          if (session && session.customized) {
            self._updateButtonState(true);
          } else {
            self._updateButtonState(false);
          }
        }
      });

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
     * Calculate a darker shade of a hex color for hover states
     */
    _darkenColor: function(hex, percent) {
      // Remove # if present
      hex = hex.replace('#', '');
      
      // Parse hex to RGB
      let r = parseInt(hex.substring(0, 2), 16);
      let g = parseInt(hex.substring(2, 4), 16);
      let b = parseInt(hex.substring(4, 6), 16);
      
      // Darken
      r = Math.max(0, Math.floor(r * (1 - percent / 100)));
      g = Math.max(0, Math.floor(g * (1 - percent / 100)));
      b = Math.max(0, Math.floor(b * (1 - percent / 100)));
      
      // Convert back to hex
      return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    },

    /**
     * Convert hex to rgba for box shadows
     */
    _hexToRgba: function(hex, alpha) {
      hex = hex.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    /**
     * Inject CSS styles
     */
    _injectStyles: function() {
      const buttonColor = this.config.buttonColor;
      const buttonHoverColor = this._darkenColor(buttonColor, 10);
      const buttonShadowColor = this._hexToRgba(buttonColor, 0.25);
      
      const headerColor = this.config.headerColor;
      const headerGradientEnd = this._darkenColor(headerColor, 10);

      const styles = `
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Mitr:wght@400;600;700&display=swap');

        .treatink-personalize-btn {
          display: inline-block;
          padding: 12px 24px;
          margin-bottom: 12px;
          background-color: ${buttonColor};
          color: #FFFDFB;
          border: none;
          border-radius: 8px;
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-align: center;
          width: 100%;
          max-width: 400px;
          box-sizing: border-box;
          letter-spacing: 0.5px;
        }

        .treatink-personalize-btn:hover {
          background-color: ${buttonHoverColor};
          transform: translateY(-2px);
          box-shadow: 0 8px 20px ${buttonShadowColor};
        }

        .treatink-personalize-btn:active {
          transform: translateY(0);
        }

        .treatink-personalize-btn.personalized {
          background-color: #8BEA06;
          color: #0D1221;
        }

        .treatink-personalize-btn.personalized:hover {
          background-color: #7ACC05;
          box-shadow: 0 8px 20px rgba(139, 234, 6, 0.25);
        }

        .treatink-personalize-btn.personalized::before {
          content: "✓ ";
          margin-right: 6px;
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
          background-color: rgba(13, 18, 33, 0.9);
          z-index: 999999;
          justify-content: center;
          align-items: center;
          animation: treatinkFadeIn 0.3s ease;
          backdrop-filter: blur(4px);
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
          border-radius: 16px;
          box-shadow: 0 25px 80px rgba(13, 18, 33, 0.35);
          animation: treatinkSlideUp 0.3s ease;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .treatink-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 32px;
          background: linear-gradient(135deg, ${headerColor} 0%, ${headerGradientEnd} 100%);
          border-radius: 16px 16px 0 0;
          flex-shrink: 0;
        }

        .treatink-modal-title {
          font-family: 'Mitr', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 28px;
          font-weight: 600;
          color: #FFFDFB;
          margin: 0;
          letter-spacing: 0.5px;
        }

        .treatink-modal-close {
          background: rgba(255, 253, 251, 0.15);
          border: 2px solid rgba(255, 253, 251, 0.3);
          font-size: 28px;
          color: #FFFDFB;
          cursor: pointer;
          line-height: 1;
          padding: 0;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          transition: all 0.2s ease;
          font-weight: 300;
        }

        .treatink-modal-close:hover {
          background: rgba(255, 253, 251, 0.25);
          border-color: rgba(255, 253, 251, 0.5);
        }

        .treatink-modal-close:active {
          transform: scale(0.95);
        }

        .treatink-modal-iframe {
          width: 100%;
          height: 100%;
          border: none;
          flex-grow: 1;
        }

        .treatink-modal-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        @keyframes treatinkFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes treatinkSlideUp {
          from {
            transform: translateY(30px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @media (max-width: 768px) {
          .treatink-modal-content {
            width: 100%;
            height: 100%;
            max-width: none;
            border-radius: 0;
          }

          .treatink-modal-header {
            padding: 16px 20px;
            border-radius: 0;
          }

          .treatink-modal-title {
            font-size: 22px;
          }

          .treatink-modal-close {
            width: 36px;
            height: 36px;
            font-size: 24px;
          }
        }
      `;

      const styleTag = document.createElement('style');
      styleTag.innerHTML = styles;
      document.head.appendChild(styleTag);
      this._log('Styles injected');
    },

    /**
     * Inject personalize button
     */
    _injectPersonalizeButton: function() {
      const btn = document.createElement('button');
      btn.setAttribute('data-treatink-personalize', 'true');
      btn.className = `${this.config.customizeButtonClass} treatink-personalize-btn`;
      btn.textContent = this.config.customizeButtonText;
      btn.type = 'button';

      // First, try to insert before custom element if specified
      if (this.config.personalizeButtonInsertBefore) {
        const customElement = document.getElementById(this.config.personalizeButtonInsertBefore);
        if (customElement && customElement.parentNode) {
          customElement.parentNode.insertBefore(btn, customElement);
          this._log(`Personalize button injected before custom element: ${this.config.personalizeButtonInsertBefore}`);
          return;
        } else {
          this._log(`Custom element not found: ${this.config.personalizeButtonInsertBefore}, falling back to add-to-cart selector`);
        }
      }

      // Fallback to add-to-cart button
      const addToCartBtn = document.querySelector(this.config.addToCartSelector);
      if (addToCartBtn && addToCartBtn.parentNode) {
        addToCartBtn.parentNode.insertBefore(btn, addToCartBtn);
        this._log('Personalize button injected before add-to-cart button');
      }
    },

    /**
     * Create modal structure
     */
    _createModal: function() {
      const modalOverlay = document.createElement('div');
      modalOverlay.id = MODAL_ID;
      modalOverlay.className = 'treatink-modal-overlay';

      const modalContent = document.createElement('div');
      modalContent.className = 'treatink-modal-content';

      const modalHeader = document.createElement('div');
      modalHeader.className = 'treatink-modal-header';

      const modalTitle = document.createElement('h2');
      modalTitle.className = 'treatink-modal-title';
      modalTitle.textContent = 'Personalize Your Product';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'treatink-modal-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.type = 'button';

      modalHeader.appendChild(modalTitle);
      modalHeader.appendChild(closeBtn);

      const iframe = document.createElement('iframe');
      iframe.className = 'treatink-modal-iframe';
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups');

      modalContent.appendChild(modalHeader);
      modalContent.appendChild(iframe);
      modalOverlay.appendChild(modalContent);
      document.body.appendChild(modalOverlay);

      this._log('Modal created');
    },

    /**
     * Setup event listeners
     */
    _setupEventListeners: function() {
      const self = this;

      // Personalize button click
      document.addEventListener('click', (e) => {
        if (e.target.getAttribute('data-treatink-personalize') === 'true') {
          self._openModal();
        }
      });

      // Modal close button
      const closeBtn = document.querySelector('.treatink-modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => self._closeModal());
      }

      // Click outside modal to close
      const modalOverlay = document.getElementById(MODAL_ID);
      if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
          if (e.target === modalOverlay) {
            self._closeModal();
          }
        });
      }

      // Listen for postMessage from customizer iframe
      window.addEventListener('message', (event) => {
        // Handle artwork saved message from customizer
        if (event.data.type === 'treatink_artwork_saved') {
          this._log('Artwork saved message received:', event.data);
          
          const sessionUuid = event.data.sessionUuid;
          const artworkUrl = event.data.artworkUrl;
          
          // Update local session with artwork URL
          const session = this._getPersonalizationSession();
          if (session) {
            session.customized = true;
            session.uuid = sessionUuid;
            session.artworkUrl = artworkUrl;
            this._savePersonalizationSession(session);
          }
          
          // Close the modal first
          this._closeModal();
          
          // Auto-add to cart and redirect
          this._autoAddToCartAndRedirect(sessionUuid, artworkUrl);
          
          // Call user callback if provided
          if (this.config.onPersonalizationComplete) {
            this.config.onPersonalizationComplete({ sessionUuid, artworkUrl });
          }
        }
        
        // Legacy support for older message format
        if (event.data.type === 'treatink_personalization_complete') {
          const payload = event.data.payload;
          this._log('Personalization complete:', payload);
          
          // Save session locally
          this._savePersonalizationSession({
            uuid: payload.sessionUuid,
            productId: this.config.productId,
            customized: true,
            customizationData: payload
          });
          
          // Store in backend for webhook matching
          this._storePendingPersonalization(payload.sessionUuid, this.config.productId, payload);
          
          // Update button to show personalized state
          this._updateButtonState(true);
          
          // Close the modal
          this._closeModal();
          
          // Call user callback if provided
          if (this.config.onPersonalizationComplete) {
            this.config.onPersonalizationComplete(payload);
          }
        }
      });

      // Intercept add to cart
      this._interceptAddToCart();

      this._log('Event listeners setup complete');
    },

    /**
     * Open modal and load customizer
     */
    _openModal: async function() {
      const modal = document.getElementById(MODAL_ID);
      if (!modal) return;
      
      // Create personalization session locally
      const session = {
        uuid: this._generateUUID(),
        productId: this.config.productId,
        customized: false,
        createdAt: new Date().toISOString()
      };
      
      this._savePersonalizationSession(session);
      
      // Create session in database and get back the actual sessionUuid
      const dbSession = await this._createSessionInDatabase(session);
      if (!dbSession) {
        console.error('[TreatInk SDK] Failed to create session, aborting');
        return;
      }
      
      // Update local session with database UUID
      session.uuid = dbSession.sessionUuid;
      this._savePersonalizationSession(session);
      
      // Show modal only after successful session creation
      modal.classList.add('active');
      
      // Build customizer URL using the sessionUuid from database
      const customizeUrl = TREATINK_CONFIG[this.config.environment].customizeUrl;
      
      const petTypesParam = this.config.petTypes.join(',');
      const customizerUrl = `${customizeUrl}?apiMode=true&uuid=${dbSession.sessionUuid}&platform=${this.config.platform}&productId=${this.config.productId}&hostname=${this.hostname}&petTypes=${petTypesParam}`;
      const iframe = modal.querySelector('.treatink-modal-iframe');
      if (iframe) {
        iframe.src = customizerUrl;
        this._log('Modal opened with customizer URL:', customizerUrl);
      }
    },

    /**
     * Create personalization session in database
     */
    _createSessionInDatabase: async function(session) {
      try {
        const supabaseUrl = TREATINK_CONFIG[this.config.environment].supabaseUrl;
        const response = await fetch(`${supabaseUrl}/functions/v1/create-personalization-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            externalProductId: session.productId,
            platform: this.config.platform,
            salesChannelHostname: this.hostname
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[TreatInk SDK] Session creation failed:', errorData.error);
          return null;
        }
        
        const responseData = await response.json();
        this._log('Session created in database:', responseData.sessionUuid);
        return responseData;
      } catch (error) {
        console.error('[TreatInk SDK] Error creating session:', error);
        return null;
      }
    },

    /**
     * Store pending personalization for webhook order matching
     * This is called after customization completes, stores data server-side
     */
    _storePendingPersonalization: async function(sessionUuid, productId, customizationData) {
      try {
        const supabaseUrl = TREATINK_CONFIG[this.config.environment].supabaseUrl;
        const response = await fetch(`${supabaseUrl}/functions/v1/pending-personalization`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sessionUuid: sessionUuid,
            productId: productId,
            platform: this.config.platform,
            hostname: this.hostname,
            customizationData: customizationData
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[TreatInk SDK] Failed to store pending personalization:', errorData.error);
          return false;
        }
        
        this._log('Pending personalization stored:', sessionUuid);
        return true;
      } catch (error) {
        console.error('[TreatInk SDK] Error storing pending personalization:', error);
        return false;
      }
    },

    /**
     * Close modal
     */
    _closeModal: function() {
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.classList.remove('active');
        // Clear iframe src to stop any ongoing processes
        const iframe = modal.querySelector('.treatink-modal-iframe');
        if (iframe) {
          iframe.src = 'about:blank';
        }
        this._log('Modal closed');
      }
    },

    /**
     * Generate UUID
     */
    _generateUUID: function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },

    /**
     * Get personalization session
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
     * Clear the current product's personalization session
     * Called after successfully adding to cart so user can start fresh
     */
    _clearCurrentSession: function() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        
        const sessions = JSON.parse(stored);
        delete sessions[this.config.productId];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        this._log('Current product session cleared from localStorage');
      } catch (e) {
        console.error('[TreatInk SDK] Error clearing session:', e);
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
        // Keep original button text - don't change to "Edit Personalization"
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
      const self = this;
      const addToCartButton = document.querySelector(this.config.addToCartSelector);
      if (!addToCartButton) return;

      const form = addToCartButton.closest('form');
      if (!form) return;

      // Method 1: Traditional form submit listener
      form.addEventListener('submit', (e) => {
        const session = this._getPersonalizationSession();
        if (!session || !session.customized) {
          this._log('No personalization to add to cart');
          return;
        }

        // Add personalization UUID to cart
        this._addPersonalizationToCart(form, session);
      });

      // Method 2: Click listener for AJAX add-to-cart themes
      addToCartButton.addEventListener('click', function() {
        const session = self._getPersonalizationSession();
        if (!session || !session.customized) {
          self._log('No personalization for AJAX cart');
          return;
        }

        // Wait for AJAX to complete, then update cart attributes
        setTimeout(function() {
          self._updateShopifyCartAttributes(session.uuid);
        }, 1000);
      });

      this._log('Add to cart interceptor installed');
    },

    /**
     * Update Shopify cart attributes via AJAX API
     */
    _updateShopifyCartAttributes: function(uuid) {
      const self = this;
      
      // First get current cart to check for existing attributes
      fetch('/cart.js')
        .then(response => response.json())
        .then(cart => {
          const existingAttr = cart.attributes && cart.attributes.treatink_personalizations;
          const newValue = existingAttr ? `${existingAttr},${uuid}` : uuid;
          
          // Update cart attributes
          return fetch('/cart/update.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              attributes: {
                treatink_personalizations: newValue
              }
            })
          });
        })
        .then(response => response.json())
        .then(cart => {
          self._log('Cart attributes updated via AJAX:', cart.attributes);
        })
        .catch(error => {
          self._log('Error updating cart attributes:', error);
        });
    },

    /**
     * Auto-add product to cart with personalization and redirect to cart page
     * Called automatically after artwork is saved
     */
    _autoAddToCartAndRedirect: function(sessionUuid, artworkUrl) {
      const self = this;
      
      if (this.config.platform !== 'shopify') {
        this._log('Auto-add not yet implemented for platform:', this.config.platform);
        return;
      }

      // Get the variant ID from the product form
      const variantInput = document.querySelector('input[name="id"]') || 
                          document.querySelector('select[name="id"]');
      
      if (!variantInput) {
        this._log('Could not find variant input, falling back to manual add');
        this._updateButtonState(true);
        return;
      }

      const variantId = variantInput.value;
      
      if (!variantId) {
        this._log('No variant ID found');
        this._updateButtonState(true);
        return;
      }

      this._log('Auto-adding to cart, variant:', variantId);

      // Get quantity (default to 1)
      const qtyInput = document.querySelector('input[name="quantity"]');
      const quantity = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

      // Build cart item with line item properties
      const cartItem = {
        id: variantId,
        quantity: quantity,
        properties: {
          '_treatink_uuid': sessionUuid,
          '_treatink_artwork': artworkUrl || ''
        }
      };

      // Add to cart via Shopify AJAX API
      fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cartItem)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to add to cart');
        }
        return response.json();
      })
      .then(item => {
        self._log('Item added to cart:', item);
        
        // Also update cart-level attributes for webhook
        return self._updateShopifyCartAttributesAsync(sessionUuid);
      })
      .then(() => {
        // Clear the session so user can start fresh if they return
        self._clearCurrentSession();
        
        // Also reset button state in case of bfcache (back-forward cache)
        self._updateButtonState(false);
        
        // Redirect to cart page
        self._log('Redirecting to cart...');
        window.location.href = '/cart';
      })
      .catch(error => {
        self._log('Error auto-adding to cart:', error);
        // Fall back to showing the button as personalized
        self._updateButtonState(true);
      });
    },

    /**
     * Update Shopify cart attributes (async version that returns promise)
     */
    _updateShopifyCartAttributesAsync: function(uuid) {
      const self = this;
      
      return fetch('/cart.js')
        .then(response => response.json())
        .then(cart => {
          const existingAttr = cart.attributes && cart.attributes.treatink_personalizations;
          const newValue = existingAttr ? `${existingAttr},${uuid}` : uuid;
          
          return fetch('/cart/update.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              attributes: {
                treatink_personalizations: newValue
              }
            })
          });
        })
        .then(response => response.json())
        .then(cart => {
          self._log('Cart attributes updated:', cart.attributes);
          return cart;
        });
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
      // Store personalization UUID in hidden cart attribute
      // Cart attributes are hidden from customers and packing slips
      // They're automatically carried through to the order by Shopify
      
      // Try to find existing attribute input
      let attrInput = form.querySelector('input[name="attributes[treatink_personalizations]"]');
      
      if (attrInput) {
        // Append to existing list (comma-separated)
        const existing = attrInput.value;
        attrInput.value = existing ? `${existing},${data.uuid}` : data.uuid;
      } else {
        // Create new hidden attribute input
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'attributes[treatink_personalizations]';
        input.value = data.uuid;
        form.appendChild(input);
      }

      this._log('Added to Shopify cart attribute:', data.uuid);
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
      // Use provided personalizations or get all from localStorage
      let personalizedItems = orderData.personalizations;
      if (!personalizedItems) {
        const personalizations = this.getAllPersonalizations();
        personalizedItems = Object.values(personalizations)
          .filter(p => p.customized)
          .map(p => ({
            uuid: p.uuid,
            productId: p.productId
          }));
      }

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
            'Content-Type': 'application/json'
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
    _log: function(message, data) {
      if (!this.config || !this.config.debug) {
        return;
      }
      
      const timestamp = new Date().toLocaleTimeString();
      const prefix = `[TreatInk SDK ${timestamp}]`;
      
      if (data !== undefined) {
        console.log(prefix, message, data);
      } else {
        console.log(prefix, message);
      }
    }
  };

  // Expose TreatInk to global scope
  window.TreatInk = TreatInk;

})(window, document);
