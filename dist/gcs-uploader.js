(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["gcsUploader"] = factory();
	else
		root["gcsUploader"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;
/******/
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * This module implements the logic to perform resumable uploads to GCS
	 * from a web browser.
	 *
	 * It makes use of the File and FileReader Web APIs and it requires a small
	 * server piece able to request and provide resumable uploads session URIs.
	 *
	 * Usage:
	 *
	 * ```javascript
	 * import gcsUploader from 'gcs-uploader';
	 *
	 * const upload = gcsUploader.run(file);
	 * upload.onprogress: function(progress) {
	 *   console.log('Sent', progress.sent);
	 *   console.log('Pending', progress.pending);
	 * };
	 * upload.ondone: function(info) {
	 *   console.log('File uploaded. Metadata', info);
	 * };
	 * upload.oncancel: function() {...};
	 * upload.onpause: function() {...};
	 * upload.onerror: function(error) {
	 *   console.error(error);
	 * }
	 *
	 * // upload.cancel();
	 * // upload.pause();
	 * // upload.resume();
	 * ```
	 */
	
	'use strict';
	
	var _steamer = __webpack_require__(1);
	
	var _steamer2 = _interopRequireDefault(_steamer);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	var RESUME_OFFSET = '*';
	
	/**
	 * Upload states.
	 */
	var DONE = 'done';
	var INPROGRESS = 'inprogress';
	var PAUSE = 'pause';
	var CANCEL = 'cancel';
	
	var clearEventQueue = function clearEventQueue(eventQueue, event) {
	  while (eventQueue.length) {
	    event(eventQueue.shift());
	  }
	};
	
	/**
	 * Helper class to keep state information about a file upload.
	 *
	 * Every state update causes the trigger of an event related to the
	 * state change. For example, updating `upload.progress` triggers
	 * the `onprogress` callback.
	 */
	function Upload(size, contentType, steamer, sessionUri) {
	  // We need to queue events triggered before the callbacks are set.
	  // Once a callback is set, we check the corresponding event queue
	  // and fire its events.
	  this.eventQueue = {
	    onprogress: [],
	    onerror: [],
	    ondone: [],
	    oncancel: [],
	    onpause: []
	  };
	
	  this.size = size;
	  this.contentType = contentType;
	  this.steamer = steamer;
	  this.sessionUri = sessionUri;
	
	  var self = this;
	  this.state = {
	    _progress: 0,
	    _error: null,
	    _done: false,
	    _cancel: false,
	    _pause: false,
	    set progress(offset) {
	      if (!offset || offset === RESUME_OFFSET) {
	        return;
	      }
	
	      var progress = offset;
	
	      if (!self._onprogress) {
	        self.eventQueue.onprogress.push(progress);
	        return;
	      }
	
	      this._progress = progress;
	      self._onprogress(progress);
	    },
	    set error(error) {
	      if (!self._onerror) {
	        self.eventQueue.onerror.push(error);
	        return;
	      }
	      this._error = error;
	      self._onerror(error);
	    },
	    set done(done) {
	      if (!done) {
	        return;
	      }
	
	      this._done = true;
	
	      if (!self._ondone) {
	        self.eventQueue.ondone[0] = true;
	        return;
	      }
	
	      self._ondone();
	    },
	    set cancel(cancel) {
	      if (!cancel) {
	        return;
	      }
	
	      this._cancel = cancel;
	
	      if (!self._oncancel) {
	        self.eventQueue.oncancel[0] = cancel;
	        return;
	      }
	
	      self._oncancel();
	    },
	    set pause(pause) {
	      this._pause = pause;
	
	      if (!self._onpause) {
	        self.eventQueue.onpause[0] = pause;
	        return;
	      }
	
	      if (!pause) {
	        return;
	      }
	
	      // We only trigger the onpause event when we go from
	      // inprogress to pause state.
	      self._onpause();
	    }
	  };
	}
	
	Upload.prototype = function () {
	  return {
	    /**
	     * Create a Upload instance.
	     *
	     * @constructs Upload
	     *
	     * @param {number} size - Upload size.
	     * @param {string} contentType - Content Type of the file being uploaded.
	     */
	    constructor: Upload,
	    set progress(progress) {
	      this.state.progress = progress;
	    },
	
	    /**
	     * Upload error setter. Triggers the .onerror callback.
	     *
	     * @param {any} error - Error details.
	     */
	    set error(error) {
	      this.state.error = error;
	    },
	
	    /**
	     * Cancel an ongoing upload. Triggers the .oncancel callback.
	     */
	    cancel: function cancel() {
	      this.state.cancel = true;
	    },
	
	
	    /**
	     * Sets the upload as done. Triggers the .ondone callback.
	     */
	    done: function done() {
	      this.state.done = true;
	    },
	
	
	    /**
	     * Pauses the upload. Triggers the .onpause callback.
	     */
	    pause: function pause() {
	      this.state.pause = true;
	    },
	
	
	    /**
	     * Resumes a paused upload.
	     */
	    resume: function resume() {
	      this.state.pause = false;
	      doUpload(this, RESUME_OFFSET);
	    },
	
	
	    /**
	     * Current state getter. An upload can have three states:
	     * - INPROGRESS
	     * - PAUSE
	     * - CANCEL
	     * - DONE
	     */
	    get currentState() {
	      if (this.state._done) {
	        return DONE;
	      }
	
	      if (this.state._cancel) {
	        return CANCEL;
	      }
	
	      if (this.state._pause) {
	        return PAUSE;
	      }
	
	      return INPROGRESS;
	    },
	
	    /**
	     * onprogress callback setter.
	     *
	     * @param {function} cb - callback.
	     */
	    set onprogress(cb) {
	      this._onprogress = cb;
	      clearEventQueue(this.eventQueue.onprogress, cb);
	    },
	
	    /**
	     * onerror callback setter.
	     *
	     * @param {function} cb - callback.
	     */
	    set onerror(cb) {
	      this._onerror = cb;
	      clearEventQueue(this.eventQueue.onerror, cb);
	    },
	
	    /**
	     * ondone callback setter.
	     *
	     * @param {function} cb - callback.
	     */
	    set ondone(cb) {
	      this._ondone = cb;
	      clearEventQueue(this.eventQueue.ondone, cb);
	    },
	
	    /**
	     * oncancel callback setter.
	     *
	     * @param {function} cb - callback.
	     */
	    set oncancel(cb) {
	      this._oncancel = cb;
	      clearEventQueue(this.eventQueue.oncancel, cb);
	    },
	
	    /**
	     * onpause callback setter.
	     *
	     * @param {function} cb - callback.
	     */
	    set onpause(cb) {
	      this._onpause = cb;
	      clearEventQueue(this.eventQueue.onpause, cb);
	    }
	  };
	}();
	
	var uploadChunk = function uploadChunk(sessionUri, chunk, contentType, range) {
	  var options = {
	    method: 'put',
	    mode: 'cors'
	  };
	
	  var headers = {
	    'Access-Control-Allow-Origin': '*'
	  };
	
	  if (!range.includes('*')) {
	    headers = Object.assign(headers, {
	      'Content-Length': chunk.size,
	      'Content-Type': contentType,
	      'Content-Range': range
	    });
	    options.body = chunk.data;
	  }
	
	  options.headers = headers;
	
	  return fetch(sessionUri, options).then(function (response) {
	    if (response.status === 200 || response.status == 201) {
	      // Upload completed!
	      return { done: true };
	    }
	
	    if (response.status === 308) {
	      // Chunk uploaded, but there is still pending data to send.
	      var rangeHeader = response.headers.get('Range');
	      var lastByteReceived = rangeHeader.split('-')[1];
	      if (!lastByteReceived) {
	        throw new Error('Invalid \'Range\' header received');
	      }
	      return { offset: parseInt(lastByteReceived) };
	    }
	
	    // Something went wrong, the service is unavailable, so we need to stop
	    // for a bit and try to resume our upload.
	    return { offset: RESUME_OFFSET };
	  });
	};
	
	var doUpload = function doUpload(upload, offset) {
	  var retry = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
	
	  upload.steamer.next(offset).then(function (chunk) {
	    var range = void 0;
	
	    if (offset) {
	      if (offset === RESUME_OFFSET) {
	        // Request offset
	        range = 'bytes *';
	      } else {
	        // Resume upload from offset
	        range = 'bytes ' + offset + '-' + (offset + chunk.size - 1);
	      }
	    } else {
	      // Start upload from scratch
	      range = 'bytes 0-' + (chunk.size - 1);
	    }
	
	    // Format range
	    range = range + '/' + upload.size;
	
	    return uploadChunk(upload.sessionUri, chunk, upload.contentType, range);
	  }).then(function (response) {
	    if (upload.currentState !== INPROGRESS) {
	      return;
	    }
	
	    if (response.done) {
	      return upload.done();
	    }
	
	    if (response.offset) {
	      upload.progress = offset;
	      return doUpload(upload, response.offset);
	    }
	
	    throw new Error('Unexpected response');
	  }).catch(function (error) {
	    upload.error = error;
	
	    if (upload.currentState === INPROGRESS && retry < 5) {
	      // Retry maximum 5 times, wait 5 seconds between retries
	
	      setTimeout(function () {
	        doUpload(upload, RESUME_OFFSET, retry + 1);
	      }, 5000);
	    }
	  });
	};
	
	/**
	 * Module entry point. It performs the core logic of the uploader. The basic
	 * algorithm is:
	 *
	 * 1. Request a session URL to the GCS proxy server.
	 * 2. Upload chunks of data to this session URL.
	 * 2.1. If one of these chunks of data fails to upload, retry until it succeeds
	 *      or state.cancel() is called.
	 */
	var run = function run(file, sessionUri, chunkSize) {
	  if (!file) {
	    throw new Error('You need to provide a file to upload');
	  }
	
	  var steamer = new _steamer2.default(file, chunkSize);
	  var upload = new Upload(file.size, file.type, steamer, sessionUri);
	
	  doUpload(upload, RESUME_OFFSET);
	
	  return upload;
	};
	
	module.exports = { run: run };

/***/ },
/* 1 */
/***/ function(module, exports) {

	'use strict';
	
	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();
	
	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
	
	var Steamer = function () {
	  var DEFAULT_CHUNK_SIZE = 256 * 1024 * 4 * 100; // 100 MB
	
	  /**
	   * Steamer is a helper class to ease the process of slicing a file in
	   * small chunks of data.
	   */
	
	  var Steamer = function () {
	    /**
	     * Create a Steamer instance.
	     *
	     * @constructs Steamer
	     *
	     * @param {string} filename - File to be uploaded.
	     * @param {object} chunkSize - Number of bytes of each file chunk.
	     */
	    function Steamer(filename, chunkSize) {
	      _classCallCheck(this, Steamer);
	
	      if (!window.File || !window.FileReader) {
	        throw new Error('Unsupported File API');
	      }
	
	      if (!filename) {
	        throw new Error('Missing mandatory file name');
	      }
	
	      this.file = filename;
	      this.chunkSize = chunkSize || DEFAULT_CHUNK_SIZE;
	
	      this.reader = new FileReader();
	
	      this.progress = 0;
	
	      return this;
	    }
	
	    /**
	     * Get the next chunk of data.
	     *
	     * @param {number} offset - initial byte of the data chunk.
	     *
	     * @return Promise that resolves with an object containing the chunk of
	     * data and the number of bytes read.
	     */
	
	
	    _createClass(Steamer, [{
	      key: 'next',
	      value: function next(offset) {
	        var _this = this;
	
	        if (offset === '*') {
	          return Promise.resolve();
	        }
	        var _offset = offset || this.progress;
	        var limit = _offset + this.chunkSize;
	        limit = limit <= this.file.size ? limit : this.file.size;
	        var blob = this.file.slice(_offset, limit);
	        return new Promise(function (resolve, reject) {
	          _this.reader.onerror = reject;
	          _this.reader.onloadend = function (event) {
	            if (!event.target.readyState == FileReader.DONE) {
	              return;
	            }
	            _this.progress += event.loaded;
	            resolve({
	              data: event.target.result,
	              size: event.loaded
	            });
	          };
	          _this.reader.readAsArrayBuffer(blob);
	        });
	      }
	    }]);
	
	    return Steamer;
	  }();
	
	  ;
	
	  return Steamer;
	}();
	
	module.exports = Steamer;

/***/ }
/******/ ])
});
;
//# sourceMappingURL=gcs-uploader.js.map