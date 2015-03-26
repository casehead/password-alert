/**
 * @license
 * Copyright 2011 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Watches keypress events and sends potential passwords to
 * background.js via sendMessage.
 * @author adhintz@google.com (Drew Hintz)
 */

'use strict';

goog.provide('passwordcatcher');

// These requires must also be added to content_script_test.html
goog.require('goog.string');
goog.require('goog.uri.utils');


/**
 * URL prefix for the SSO/login page.
 * @type {string}
 * @private
 */
passwordcatcher.sso_url_;


/**
 * Selector for the form element on the SSO login page.
 * @type {string}
 * @private
 */
passwordcatcher.sso_form_selector_;


/**
 * Selector for the password input element on the SSO login page.
 * @type {string}
 * @private
 */
passwordcatcher.sso_password_selector_;


/**
 * Selector for the username input element on the SSO login page.
 * @type {string}
 * @private
 */
passwordcatcher.sso_username_selector_;


/**
 * The corp email domain, e.g. "@company.com".
 * @type {string}
 * @private
 */
passwordcatcher.corp_email_domain_;


/**
 * URL prefix for the GAIA login page.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.GAIA_URL_ = 'https://accounts.google.com/';


/**
 * URL prefix for second factor prompt. Happens on correct password.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.GAIA_SECOND_FACTOR_ =
    'https://accounts.google.com/SecondFactor';


/**
 * YouTube check connection page.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.YOUTUBE_CHECK_URL_ =
    'https://accounts.youtube.com/accounts/CheckConnection';


/**
 * HTML snippets from corp login pages.  Default values are for consumers.
 * @type {Array.<string>}
 * @private
 */
passwordcatcher.corp_html_ = [
  'One account. All of Google.',
  'Sign in with your Google Account',
  '<title>Sign in - Google Accounts',
  '//ssl.gstatic.com/accounts/ui/logo_2x.png'
];


/**
 * HTML snippets from corp login pages that are more specific.  Default
 * values are for consumers.
 * TODO(henryc): Add a tap test so that we will know when these changes.
 * @type {Array.<string>}
 * @private
 */
passwordcatcher.corp_html_tight_ = [
  // From https://accounts.google.com/ServiceLogin
  ('<form novalidate="" method="post" ' +
   'action="https://accounts.google.com/ServiceLoginAuth" ' +
   'id="gaia_loginform">'),
  ('<input id="Passwd" name="Passwd" type="password" placeholder="Password" ' +
   'class="">'),
  ('<input id="signIn" name="signIn" class="rc-button rc-button-submit" ' +
   'type="submit" value="Sign in">'),
  ('<input id="signIn" name="signIn" class="rc-button rc-button-submit" ' +
   'value="Sign in" type="submit">'),
  // From https://accounts.google.com/b/0/EditPasswd?hl=en
  '<div class="editpasswdpage main content clearfix">'
];


/**
 * Email address of the security admin.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.security_email_address_;


/**
 * Whitelist of domain suffixes that are not phishing.  Default
 * values are for consumers.
 * @type {Array.<string>}
 * @private
 */
passwordcatcher.whitelist_top_domains_ = [
  'accounts.google.com'
];


/**
 * Maximum length for passwords for Google accounts.
 * @type {number}
 * @private
 */
passwordcatcher.max_length_ = 100;


/**
 * If no key presses for this many seconds, flush buffer.
 * @type {number}
 * @private
 * @const
 */
passwordcatcher.SECONDS_TO_CLEAR_ = 10;


/**
 * ASCII code for enter character.
 * @type {number}
 * @private
 * @const
 */
passwordcatcher.ENTER_ASCII_CODE_ = 13;


/**
 * Number of digits in a valid OTP.
 * @type {number}
 * @private
 */
passwordcatcher.otp_length_ = 6;


/**
 * The URL for the current page.
 * @private
 * @type {string}
 */
passwordcatcher.url_ = location.href.toString();


/**
 * If Password Catcher is running on the current page.
 * @private
 * @type {boolean}
 */
passwordcatcher.isRunning_ = false;


/**
 * The most recently typed characters for this page.
 * @private
 * @type {string}
 */
passwordcatcher.typedChars_;


/**
 * Time that the most recent character was typed.
 * @private
 * @type {Date}
 */
passwordcatcher.typedTime_;


/**
 * The timeStamp from the most recent keypress event.
 * @private
 * @type {number}
 */
passwordcatcher.lastKeypressTimeStamp_;


/**
 * Password lengths for passwords that are being watched.
 * If an array offset is true, then that password length is watched.
 * Value comes from background.js.
 * @private
 * @type {Array.<boolean>}
 */
passwordcatcher.passwordLengths_;


/**
 * Are we watching for an OTP after a valid password entry?
 * @private
 * @type {boolean}
 */
passwordcatcher.otpMode_ = false;


/**
 * Time that the password was typed that resulted in enabling otpMode.
 * @private
 * @type {Date}
 */
passwordcatcher.otpTime_;


/**
 * OTP must be typed within this time since the password was typed.
 * @type {number}
 * @private
 * @const
 */
passwordcatcher.SECONDS_TO_CLEAR_OTP_ = 60;


/**
 * Number of OTP digits that have been typed so far.
 * @private
 * @type {number}
 */
passwordcatcher.otpCount_ = 0;


/**
 * Is password catcher used in enterprise environment.  If false, then it's
 * used by individual consumer.
 * @type {boolean}
 * @private
 */
passwordcatcher.isEnterpriseUse_ = false;


/**
 * The text to display in the password warning banner.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.PASSWORD_WARNING_BANNER_TEXT_ =
    '<span id="warning_banner_header">' +
    chrome.i18n.getMessage('password_warning_banner_header') + '</span>' +
    '<span id="warning_banner_body">' +
    chrome.i18n.getMessage('password_warning_banner_body') + '</span>';


/**
 * The link to allow the user to visit the current site.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.VISIT_THIS_SITE_LINK_ =
    '<a href="javascript:void(0)" style="background-color: black; ' +
    'color: white; text-decoration: underline;" ' +
    'onclick="javascript:document.getElementById(\'warning_banner\')' +
    '.style.display = \'none\';">visit this site</a>';


/**
 * The text to display in the phishing warning banner.
 * @type {string}
 * @private
 * @const
 */
passwordcatcher.PHISHING_WARNING_BANNER_TEXT_ =
    '<span id="warning_banner_header">' +
    chrome.i18n.getMessage('phishing_warning_banner_header') + '</span>' +
    '<span id="warning_banner_body">' +
    chrome.i18n.getMessage('phishing_warning_banner_body') + '</span>';


/**
 * Set the managed policy values into the configurable variables.
 * @param {function()} callback Executed after policy values have been set.
 * @private
 */
passwordcatcher.setManagedPolicyValuesIntoConfigurableVariables_ =
    function(callback) {
  chrome.storage.managed.get(function(managedPolicy) {
    console.log('Setting managed policy.');
    if (Object.keys(managedPolicy).length == 0) {
      console.log('Consumer use.');
      passwordcatcher.isEnterpriseUse_ = false;
    } else {
      console.log('Enterprise use.');
      passwordcatcher.isEnterpriseUse_ = true;
      passwordcatcher.corp_email_domain_ = managedPolicy['corp_email_domain'];
      passwordcatcher.corp_html_ = managedPolicy['corp_html'];
      passwordcatcher.corp_html_tight_ = managedPolicy['corp_html_tight'];
      passwordcatcher.security_email_address_ =
          managedPolicy['security_email_address'];
      passwordcatcher.sso_form_selector_ = managedPolicy['sso_form_selector'];
      passwordcatcher.sso_password_selector_ =
          managedPolicy['sso_password_selector'];
      passwordcatcher.sso_url_ = managedPolicy['sso_url'];
      passwordcatcher.sso_username_selector_ =
          managedPolicy['sso_username_selector'];
      passwordcatcher.whitelist_top_domains_ =
          managedPolicy['whitelist_top_domains'];

      if (managedPolicy['max_length']) {
        passwordcatcher.max_length_ = managedPolicy['max_length'];
      }
      if (managedPolicy['otp_length']) {
        passwordcatcher.otp_length_ = managedPolicy['otp_length'];
      }
    }
    callback();
  });
};


/**
 * Complete page initialization.  This is executed after managed policy values
 * have been set.
 *
 * Save or delete any existing passwords. Listen for form submissions on
 * corporate login pages.
 * @private
 */
passwordcatcher.completePageInitialization_ = function() {
  // Ignore YouTube login CheckConnection because the login page makes requests
  // to it, but that does not mean the user has successfully authenticated.
  if (goog.string.startsWith(passwordcatcher.url_,
                             passwordcatcher.YOUTUBE_CHECK_URL_)) {
    console.log('YouTube login url detected: ' + passwordcatcher.url_);
    return;
  }
  if (passwordcatcher.sso_url_ &&
      goog.string.startsWith(passwordcatcher.url_,
                             passwordcatcher.sso_url_)) {
    console.log('SSO login url is detected: ' + passwordcatcher.url_);
    chrome.runtime.sendMessage({action: 'deletePossiblePassword'});
    var loginForm = document.querySelector(passwordcatcher.sso_form_selector_);
    if (loginForm) {  // null if the user gets a Password Change Warning.
      loginForm.addEventListener(
          'submit', passwordcatcher.saveSsoPassword_, true);
    }
  } else if (goog.string.startsWith(passwordcatcher.url_,
                                    passwordcatcher.GAIA_URL_)) {
    console.log('Google login url is detected: ' + passwordcatcher.url_);
    if (goog.string.startsWith(passwordcatcher.url_,
                               passwordcatcher.GAIA_SECOND_FACTOR_)) {
      console.log('Second factor url is detected.');
      // Second factor page is only displayed when the password is correct.
      chrome.runtime.sendMessage({action: 'savePossiblePassword'});
    } else {
      console.log('Second factor url is not detected: ' + passwordcatcher.url_);
      // Delete any previously considered password in case this is a re-prompt
      // when an incorrect password is entered, such as a ServiceLoginAuth page.
      chrome.runtime.sendMessage({action: 'deletePossiblePassword'});
      var loginForm = document.getElementById('gaia_loginform');
      // The chooser is also a gaia_loginform, so verify we're on a password
      // entry page.
      if (loginForm && document.getElementById('Email')) {
        loginForm.addEventListener(
            'submit', passwordcatcher.saveGaiaPassword_, true);
      }
    }
  } else {  // Not a Google login URL.
    console.log('Detected URL that is not one of the accepted login URLs: ' +
        passwordcatcher.url_);
    if (!passwordcatcher.whitelistUrl_() &&
        passwordcatcher.looksLikeGooglePageTight_()) {
      console.log('Detected possible phishing page.');
      chrome.runtime.sendMessage({action: 'looksLikeGoogle',
        url: passwordcatcher.url_,
        referer: document.referrer.toString()});
      passwordcatcher.injectWarningBanner_(
          passwordcatcher.PHISHING_WARNING_BANNER_TEXT_,
          passwordcatcher.createButtonsForPhishingWarningBanner_());
    }
    chrome.runtime.sendMessage({action: 'savePossiblePassword'});
    console.log('Completed page initialization.');
  }

  chrome.runtime.onMessage.addListener(
      /**
       * @param {string} msg JSON object containing valid password lengths.
       */
      function(msg) {
        passwordcatcher.stop_();
        passwordcatcher.start_(msg);
      });
  chrome.runtime.sendMessage({action: 'statusRequest'});
  window.addEventListener('keypress', passwordcatcher.handleKeypress_, true);
};


/**
 * Called when the page loads.
 * @private
 */
passwordcatcher.initializePage_ = function() {
  passwordcatcher.setManagedPolicyValuesIntoConfigurableVariables_(
      passwordcatcher.completePageInitialization_);
};


/**
 * Sets variables to enable watching for passwords being typed. Called when
 * a message from the options_subscriber arrives.
 * @param {string} msg JSON object containing password lengths and OTP mode.
 * @private
 */
passwordcatcher.start_ = function(msg) {
  var state = JSON.parse(msg);
  passwordcatcher.passwordLengths_ = state.passwordLengths;
  if (passwordcatcher.passwordLengths_.length == 0) {
    passwordcatcher.stop_(); // no passwords, so no need to watch
    return;
  }
  if (state.otpMode) {
    passwordcatcher.otpMode_ = true;
    passwordcatcher.otpTime_ = new Date(state.otpTime);
  }

  if ((passwordcatcher.sso_url_ &&
      goog.string.startsWith(passwordcatcher.url_,
                             passwordcatcher.sso_url_)) ||
      goog.string.startsWith(passwordcatcher.url_, passwordcatcher.GAIA_URL_)) {
    passwordcatcher.stop_(); // safe URL, so no need to watch it
    return;
  }

  passwordcatcher.typedChars_ = '';
  passwordcatcher.isRunning_ = true;
  console.log('Password catcher is running.');
};


/**
 * Disables watching on the current page.
 * @private
 */
passwordcatcher.stop_ = function() {
  passwordcatcher.isRunning_ = false;
};


/**
 * Clears OTP mode in both content_script and background.
 * @private
 */
passwordcatcher.clearOtpMode_ = function() {
  passwordcatcher.otpMode_ = false;
  // Tell background to clear otpMode_ for this tab id.
  chrome.runtime.sendMessage({action: 'clearOtpMode'});
};


/**
 * Called on each key press. Checks the most recent possible characters.
 * @param {Event} evt Key press event.
 * @private
 */
passwordcatcher.handleKeypress_ = function(evt) {
  if (!passwordcatcher.isRunning_) return;

  // Legitimate keypress events should have the view set.
  if (evt.view == null) {
    return;
  }

  // Legitimate keypress events should have increasing timeStamps.
  if (evt.timeStamp <= passwordcatcher.lastKeypressTimeStamp_) {
    return;
  }
  passwordcatcher.lastKeypressTimeStamp_ = evt.timeStamp;

  if (passwordcatcher.otpMode_) {
    var now = new Date();
    if (now - passwordcatcher.otpTime_ >
        passwordcatcher.SECONDS_TO_CLEAR_OTP_ * 1000) {
      passwordcatcher.clearOtpMode_();
    } else if (evt.charCode >= 0x30 && evt.charCode <= 0x39) {  // is a digit
      passwordcatcher.otpCount_++;
    } else if (evt.charCode > 0x20 || // non-digit printable characters reset it
               // Non-printable only allowed at start:
               passwordcatcher.otpCount_ > 0) {
      passwordcatcher.clearOtpMode_();
    }
    if (passwordcatcher.otpCount_ >= passwordcatcher.otp_length_) {
      passwordcatcher.otpAlert_();
      passwordcatcher.clearOtpMode_();
    }
  }

  if (evt.charCode == passwordcatcher.ENTER_ASCII_CODE_) {
    passwordcatcher.typedChars_ = '';
    return;
  }

  var now = new Date();
  if (now - passwordcatcher.typedTime_ >
      passwordcatcher.SECONDS_TO_CLEAR_ * 1000) {
    passwordcatcher.typedChars_ = '';
  }

  passwordcatcher.typedChars_ += String.fromCharCode(evt.charCode);
  passwordcatcher.typedTime_ = now;

  // trim the buffer when it's too big
  if (passwordcatcher.typedChars_.length >
      passwordcatcher.passwordLengths_.length) {
    passwordcatcher.typedChars_ = passwordcatcher.typedChars_.slice(
        -1 * passwordcatcher.passwordLengths_.length);
  }

  for (var i = 1; i < passwordcatcher.passwordLengths_.length; i++) {
    if (passwordcatcher.passwordLengths_[i] &&
        passwordcatcher.typedChars_.length >= i) {
      passwordcatcher.checkChars_(passwordcatcher.typedChars_.substr(-1 * i));
    }
  }
};


/**
 * Called when SSO login page is submitted. Sends possible password to
 * background.js.
 * @param {Event} evt Form submit event that triggered this. Not used.
 * @private
 */
passwordcatcher.saveSsoPassword_ = function(evt) {
  console.log('Saving SSO password.');
  if (passwordcatcher.validateSso_()) {
    var username =
        document.querySelector(passwordcatcher.sso_username_selector_).value;
    var password =
        document.querySelector(passwordcatcher.sso_password_selector_).value;
    if (username.indexOf('@') == -1) {
      username += passwordcatcher.corp_email_domain_;
    }
    chrome.runtime.sendMessage({
      action: 'setPossiblePassword',
      email: username,
      password: password
    });
  }
};


/**
 * Called when the GAIA page is submitted. Sends possible
 * password to background.js.
 * @param {Event} evt Form submit event that triggered this. Not used.
 * @private
 */
passwordcatcher.saveGaiaPassword_ = function(evt) {
  console.log('Saving gaia password.');
  //TODO(adhintz) Should we do any validation here?
  var email = document.getElementById('Email').value;
  email = goog.string.trim(email.toLowerCase());
  var password = document.getElementById('Passwd').value;
  if (passwordcatcher.isEnterpriseUse_ &&
      !goog.string.endsWith(email, passwordcatcher.corp_email_domain_)) {
    return;  // Ignore generic @gmail.com logins or for other domains.
  }
  chrome.runtime.sendMessage({
    action: 'setPossiblePassword',
    email: email,
    password: password
  });
};


/**
 * Checks if the sso login page is filled in.
 * @return {boolean} Whether the sso login page is filled in.
 * @private
 */
passwordcatcher.validateSso_ = function() {
  var username = document.querySelector(passwordcatcher.sso_username_selector_);
  var password = document.querySelector(passwordcatcher.sso_password_selector_);
  if ((username && !username.value) ||
      (password && !password.value)) {
    console.log('SSO data is not filled in.');
    return false;
  }
  console.log('SSO data is filled in.');
  return true;
};


/**
 * Sends typed strings to background.js to see if a password has been typed.
 * @param {string} typed Characters typed by the user.
 * @private
 */
passwordcatcher.checkChars_ = function(typed) {
  chrome.runtime.sendMessage({
    action: 'checkPassword',
    password: typed,
    url: passwordcatcher.url_,
    referer: document.referrer.toString()
  }, function(response) {
    // TODO(adhintz) use response.isCorrect and jsdoc to preserve the name.
    if (response) {  // Password was entered, so now watch for an OTP.
      console.log('Password has been typed.');
      passwordcatcher.otpCount_ = 0;
      passwordcatcher.otpMode_ = true;
      passwordcatcher.otpTime_ = new Date();

      if (!passwordcatcher.isEnterpriseUse_) {
        passwordcatcher.injectWarningBanner_(
            passwordcatcher.PASSWORD_WARNING_BANNER_TEXT_,
            passwordcatcher.createButtonsForPasswordWarningBanner_());
      }
    }
  });
};


/**
 * Sends OTP alert to background.js.
 * @private
 */
passwordcatcher.otpAlert_ = function() {
  chrome.runtime.sendMessage({
    action: 'otpAlert',
    url: passwordcatcher.url_,
    referer: document.referrer.toString(),
    looksLikeGoogle: passwordcatcher.looksLikeGooglePage_()
  });
};


/**
 * Detects if this page looks like a Google login page.
 * For example, a phishing page would return true.
 * @return {boolean} True if this page looks like a Google login page.
 * @private
 */
passwordcatcher.looksLikeGooglePage_ = function() {
  var allHtml = document.documentElement.innerHTML;
  for (var i in passwordcatcher.corp_html_) {
    if (allHtml.indexOf(passwordcatcher.corp_html_[i]) >= 0) {
      console.log('Looks like login page.');
      return true;
    }
  }
  console.log('Does not look like login page.');
  return false;
};


/**
 * Detects if this page looks like a Google login page, but with a more
 * strict set of rules to reduce false positives.
 * For example, a phishing page would return true.
 * @return {boolean} True if this page looks like a Google login page.
 * @private
 */
passwordcatcher.looksLikeGooglePageTight_ = function() {
  // Only look in the first 100,000 characters of a page to avoid
  // impacting performance for large pages. Although an attacker could use this
  // to avoid detection, they could obfuscate the HTML just as easily.
  var allHtml = document.documentElement.innerHTML.slice(0, 100000);
  for (var i in passwordcatcher.corp_html_tight_) {
    if (allHtml.indexOf(passwordcatcher.corp_html_tight_[i]) >= 0) {
      console.log('Looks like (tight) login page.');
      return true;
    }
  }
  console.log('Does not look like (tight) login page.');
  return false;
};


/**
 * Detects if the page is whitelisted as not a phishing page.
 * @return {boolean} True if this page is whitelisted.
 * @private
 */
passwordcatcher.whitelistUrl_ = function() {
  var domain = goog.uri.utils.getDomain(passwordcatcher.url_) || '';
  for (var i in passwordcatcher.whitelist_top_domains_) {
    if (goog.string.endsWith(domain,
                             passwordcatcher.whitelist_top_domains_[i])) {
      console.log('Whitelisted domain detected: ' + domain);
      return true;
    }
  }
  console.log('Non-whitelisted url detected: ' + domain);
  return false;
};


/**
 * Create the email to notify about about phishing warning.
 * @private
 */
passwordcatcher.createPhishingWarningEmail_ = function() {
  window.open('mailto:' + passwordcatcher.security_email_address_ + '?' +
      'subject=User has detected possible phishing site.&' +
      'body=I have visited ' + encodeURIComponent(passwordcatcher.url_) +
      ' and a phishing warning ' +
      'was triggered. Please see if this is indeed a phishing attempt and ' +
      'requires further action.');
};


/**
 * Browser's back functionality.
 * @private
 */
passwordcatcher.back_ = function() {
  window.history.back();
};


/**
 * Opens the change password page where users can reset their password.
 * @private
 */
passwordcatcher.openChangePasswordPage_ = function() {
  window.open('https://accounts.google.com/b/0/EditPasswd', '_blank',
              'resizable=yes');
};


/**
 * Close the phishing warning banner.
 * @private
 */
passwordcatcher.closeWarningBanner_ = function() {
  document.getElementById('warning_banner').style.display = 'none';
};


/**
 * Create buttons for the phishing warning banner.
 * @param {string} buttonText Text label of the button.
 * @param {string} buttonLeftPosition Position for the button from the left
 *     margin of the page.
 * @param {Function} buttonFunction Javascript that will be triggered when this
 *     button is clicked.
 * @param {boolean} isPrimaryButton Whether the button is the primary button
 *     that is preferred for the user to click.  If true, will be shown in
 *     a color that will induce the user to click.  If false, will be shown
 *     in a faded color.
 * @return {Element} button The html that represents the button.
 * @private
 */
passwordcatcher.createButton_ = function(buttonText, buttonLeftPosition,
    buttonFunction, isPrimaryButton) {
  var button = document.createElement('button');
  button.setAttribute('class', 'warning_banner_button');
  button.innerText = buttonText;
  button.style.left = buttonLeftPosition;
  button.onclick = buttonFunction;
  if (isPrimaryButton) {
    button.classList.add('warning_banner_button_primary');
  }
  return button;
};


/**
 * Create the set of buttons for the password warning banner.
 * @return {Array} The set of buttons for the password warning banner.
 * @private
 */
passwordcatcher.createButtonsForPasswordWarningBanner_ = function() {
  var resetPasswordButton = passwordcatcher.createButton_(
      chrome.i18n.getMessage('reset_password'), '20%',
      passwordcatcher.openChangePasswordPage_, true);
  var ignoreButton = passwordcatcher.createButton_(
      chrome.i18n.getMessage('ignore'), '50%',
      passwordcatcher.closeWarningBanner_, false);
  return [resetPasswordButton, ignoreButton];
};


/**
 * Create the set of buttons for the phishing warning banner.
 * @return {Array} The set of buttons for the phishing warning banner.
 * @private
 */
passwordcatcher.createButtonsForPhishingWarningBanner_ = function() {
  var contactSecurityButton = passwordcatcher.createButton_(
      chrome.i18n.getMessage('contact_security'), '20%',
      passwordcatcher.createPhishingWarningEmail_, true);
  var backButton = passwordcatcher.createButton_(
      chrome.i18n.getMessage('back'), '45%', passwordcatcher.back_, false);
  var visitThisSiteButton = passwordcatcher.createButton_(
      chrome.i18n.getMessage('visit_this_site'), '70%', passwordcatcher.closeWarningBanner_,
      false);
  return [contactSecurityButton, backButton, visitThisSiteButton];
};


/**
 * Injects a banner into the page to warn users.
 * @param {string} bannerText The text to display in the banner.
 * @param {Array} bannerButtons The set of buttons to disply in the banner.
 * @private
 */
passwordcatcher.injectWarningBanner_ = function(bannerText, bannerButtons) {
  var style = document.createElement('link');
  style.rel = 'stylesheet';
  style.type = 'text/css';
  style.href = chrome.extension.getURL('warning_banner.css');
  document.head.appendChild(style);

  var textElement = document.createElement('span');
  textElement.innerHTML = bannerText;

  var blockIcon = document.createElement('img');
  blockIcon.setAttribute('id', 'warning_banner_block_icon');
  blockIcon.setAttribute('src', chrome.extension.getURL('block.svg'));

  // A fixed-size inner container is the key to make the banner content
  // look good across different screen sizes.
  var bannerInnerContainer = document.createElement('div');
  bannerInnerContainer.setAttribute('id', 'warning_banner_inner_container');

  bannerInnerContainer.appendChild(blockIcon);
  bannerInnerContainer.appendChild(textElement);
  for (var i = 0; i < bannerButtons.length; ++i) {
    bannerInnerContainer.appendChild(bannerButtons[i]);
  }

  var bannerElement = document.createElement('div');
  bannerElement.setAttribute('id', 'warning_banner');
  bannerElement.appendChild(bannerInnerContainer);
  document.body.insertBefore(bannerElement, document.body.firstChild);

  blockIcon.focus();  // Prevent pressing Enter from triggering a button.
};

passwordcatcher.initializePage_();
