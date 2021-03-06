var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

import { FLUSH, FLUSH_LARGE_OBJECTS, PAUSE, PERSIST, PURGE, REHYDRATE, DEFAULT_VERSION } from './constants';

import autoMergeLevel1 from './stateReconciler/autoMergeLevel1';
import createPersistoid from './createPersistoid';
import defaultGetStoredState from './getStoredState';
import purgeStoredState from './purgeStoredState';

/*
  @TODO add validation / handling for:
  - persisting a reducer which has nested _persist
  - handling actions that fire before reydrate is called
*/
export default function persistReducer(config, baseReducer) {
  if (process.env.NODE_ENV !== 'production') {
    if (!config) throw new Error('config is required for persistReducer');
    if (!config.key) throw new Error('key is required in persistor config');
    if (!config.storage) throw new Error("redux-persist: config.storage is required. Try using `import storageLocal from 'redux-persist/es/storages/local'");
  }

  var version = config.version !== undefined ? config.version : DEFAULT_VERSION;
  var debug = config.debug || false;
  var stateReconciler = config.stateReconciler === undefined ? autoMergeLevel1 : config.stateReconciler;
  var getStoredState = config.getStoredState || defaultGetStoredState;
  var _persistoid = null;
  var _purge = false;
  var _paused = true;

  return function (state, action) {
    var _ref = state || {},
        _persist = _ref._persist,
        rest = _objectWithoutProperties(_ref, ['_persist']);

    var restState = rest;

    if (action.type === PERSIST) {
      // @NOTE PERSIST resumes if paused.
      _paused = false;

      // @NOTE only ever create persistoid once, ensure we call it at least once, even if _persist has already been set
      if (!_persistoid) _persistoid = createPersistoid(config);

      // @NOTE PERSIST can be called multiple times, noop after the first
      if (_persist) return state;
      if (typeof action.rehydrate !== 'function' || typeof action.register !== 'function') throw new Error('redux-persist: either rehydrate or register is not a function on the PERSIST action. This can happen if the action is being replayed. This is an unexplored use case, please open an issue and we will figure out a resolution.');

      action.register(config.key);

      getStoredState(config).then(function (restoredState) {
        var migrate = config.migrate || function (s, v) {
          return Promise.resolve(s);
        };
        migrate(restoredState, version).then(function (migratedState) {
          action.rehydrate(config.key, migratedState);
        }, function (migrateErr) {
          if (process.env.NODE_ENV !== 'production' && migrateErr) console.error('redux-persist: migration error', migrateErr);
          action.rehydrate(config.key, undefined, migrateErr);
        });
      }, function (err) {
        action.rehydrate(config.key, undefined, err);
      });

      return _extends({}, baseReducer(restState, action), {
        _persist: { version: version, rehydrated: false }
      });
    } else if (action.type === PURGE) {
      _purge = true;
      action.result(purgeStoredState(config));
      return _extends({}, baseReducer(restState, action), {
        _persist: _persist
      });
    } else if (action.type === FLUSH) {
      action.result(_persistoid && _persistoid.flush());
      return _extends({}, baseReducer(restState, action), {
        _persist: _persist
      });
    } else if (action.type === PAUSE) {
      _paused = true;
    } else if (action.type === REHYDRATE) {
      // noop on restState if purging
      if (_purge) return _extends({}, restState, {
        _persist: _extends({}, _persist, { rehydrated: true })

        // @NOTE if key does not match, will continue to default else below
      });if (action.key === config.key) {
        var reducedState = baseReducer(restState, action);
        var inboundState = action.payload;
        var reconciledRest = stateReconciler !== false ? stateReconciler(inboundState, state, reducedState, config) : reducedState;

        return _extends({}, reconciledRest, {
          _persist: _extends({}, _persist, { rehydrated: true })
        });
      }
    }

    // if we have not already handled PERSIST, straight passthrough
    if (!_persist) return baseReducer(state, action);

    // otherwise, pull off _persist, run the reducer, and update the persistoid
    // @TODO more performant workaround for combineReducers warning
    var newState = _extends({}, baseReducer(restState, action), {
      _persist: _persist
      // update the persistoid only if we are already rehydrated and are not paused
    });_persist.rehydrated && _persistoid && !_paused && _persistoid.update(newState, action.type === FLUSH_LARGE_OBJECTS);
    return newState;
  };
}