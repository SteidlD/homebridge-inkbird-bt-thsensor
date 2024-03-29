// Implements the InkbirdBtTHSensorAccessory class that manages the bluetooth sensor
//
//-----------------------------------------------------------------------
// Date        Author      Change
//-----------------------------------------------------------------------
// 04.06.2020  D. Steidl   Created
// 06.06.2020  D. Steidl   First working version
// 07.06.2020  D. Steidl   CRC16 Modbus, plausibility checks and easy to configure features implemented
// 14.06.2020  D. Steidl   Added Eve history for temperature and relative humidity, bug fix cyclic read
// 15.06.2020  D. Steidl   Added log level
// 16.06.2020  D. Steidl   Bugfix: Reference error Characteristic (fixed in 0.3.1)
// 25.06.2020  D. Steidl   Actualization also in cyclic mode, info internal/external sensor as CustomCharacteristic
// 07.02.2021  D. Steidl   Bugfix Issue #4: Incorrect temperature, "not in list - try it anyway" improved
// 01.05.2021  D. Steidl   Bugfix Issue #7: Incorrect temperature (fixed in 0.4.1)
// 09.07.2021  D. Steidl   Support for sensor types IBS-TH1-Plus, IBS-TH2 and IBS-TH2-Plus added
//                         Selection of internal or external sensor
//                         Offset for internal, external temperature sensor added
//                         Offset for internal humidity added
//-----------------------------------------------------------------------

//-----------------------------------------------------------------------
// Global variables
//-----------------------------------------------------------------------

// variables have to be declared explicitly
'use strict'

/** @const {Object} ESTATES               Enumeration for state machine */
const ESTATES = {NOT_READY: 1, STATUS_INVALID: 2, SCANNING: 3, READY4ANSWER: 4}
/** @const {Object} DDMODELS              Dictionary of models containing a dictionary with the config data of a model */
const DDMODELS = {"IBS-TH1"                     : {datalength : 9, localName : "sps", serviceDat : undefined, serviceUuids : "fff0", dualView : false},
                  "IBS-TH1-Plus"                : {datalength : 9, localName : "sps", serviceDat : undefined, serviceUuids : "fff0", dualView : true},
                  "IBS-TH2"                     : {datalength : 9, localName : "sps", serviceDat : undefined, serviceUuids : "fff0", dualView : false},
                  "IBS-TH2-Plus"                : {datalength : 9, localName : "sps", serviceDat : undefined, serviceUuids : "fff0", dualView : true},
                  "not in list - try it anyway" : 0}
/** @const {Object} ELOGLEVEL              Enumeration for log levels */
const ELOGLEVEL = {MIN:0, FATAL: 0, ERROR: 1, WARNING: 2, INFO: 3, DEBUG: 4, MAX:4}
/** @const {Object} STRLOGLEVEL            Strings for log levels */
const STRLOGLEVEL = ["Fatal", "Error", "Warning", "Info", "Debug"];

//-----------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------

// from JavaScript
const noble    = require('@abandonware/noble/index');                                              // for bluetooth low energy
const moment   = require('moment');                                                                // for timestamps for Eve history
const inherits = require('util').inherits;                                                         // for custom characteristic/service definition

// from InkbirdBtTHSensor
const CRC16_0x18005 = require('./CRC16_0x18005')

//-----------------------------------------------------------------------
// Classes 
//-----------------------------------------------------------------------

/**
 * Main class for the management of the Inkbird temperature and humidity sensors accessory
 */
class cInkbirdBtTHSensorAccessory
{
   //-----------------------------------------------------------------------
   /**
    * The accessory constructor initializes the class, loads the config, creates the required services
    * and starts the auto-refresh feature if configured.
    * 
    * @param {Object} cLog                Pointer to logging class
    * @param {Object} dConfig             Configuration for the plugin
    * @returns {void}                     nothing
    */
   constructor(cLog, dConfig)
   {
      var self = this;
      if (dConfig.loglevel >= ELOGLEVEL.DEBUG)
         cLog("Start Initialization");

      // Store and initialize values
      self.cLog                     = cLog;
      self.dConfig                  = dConfig;
      self.cRawStatus               = undefined;                                                      // Cached raw status from doCyclicGetStatus
      self.fTemperature             = undefined;                                                      // Temperature in degree Celsius
      self.fIntTemperature          = undefined;                                                      // Internal temperature in degree Celsius
      self.fExtTemperature          = undefined;                                                      // External temperature in degree Celsius
      self.fIntHumidity             = undefined;                                                      // Internal relative humidity in %
      self.bExternalSensor          = undefined;                                                      // true, if external sensor is connected
      self.fBatteryLevel            = undefined;                                                      // Battery level in %
      self.eState                   = ESTATES.NOT_READY;                                              // State of the state machine (Hardware not ready)
      self.eOldState                = undefined;                                                      // State of the state machine in last call
      self.iTimeoutId               = undefined;                                                      // Id of a started timeout to find it again (No Timeout started yet)
      self.fCallbackTemperature     = undefined;                                                      // Callback for temperature
      self.fCallbackHumidity        = undefined;                                                      // Callback for humidity
      self.fCallbackExtSensor       = undefined;                                                      // Callback for external sensor
      self.fCallbackBatteryLevel    = undefined;                                                      // Callback for battery level
      self.fCallbackLowBattery      = undefined;                                                      // Callback for low battery
      self.bQueryStarted            = false;                                                          // true if a query was started to read a value
      self.bHWReady                 = false;                                                          // Shows if hardware is ready
      self.bDualViewSensor          = false;                                                          // Shows if the sensor supports dual view of the internal and the external temperature  
      self.dcCustomCharacteristic   = {};                                                             // Self-defined characteristics

      // Analyse config, use config first, if not set then fall back to default values
      self.iLogLevel                = dConfig.loglevel || ELOGLEVEL.INFO;                             // Show infos, warnings, errors and fatal
      self.strName                  = dConfig.name;
      self.strModel                 = dConfig.model || "";
      self.dSensorCfg               = DDMODELS[self.strModel];
      if (self.dSensorCfg == undefined)
         self.Log(ELOGLEVEL.ERROR, `Invalid sensor type ${self.strModel}. See README.md for valid types!`);
      else if (self.dSensorCfg != 0)
         self.bDualViewSensor       = self.dSensorCfg.dualView;

      self.strSensor                = (self.bDualViewSensor ? (dConfig.sensor || "auto") : "auto");
      self.Log(ELOGLEVEL.DEBUG, `Using sensor: ${self.strSensor}.`);
      self.strMAC                   = (dConfig.mac_address || "").toLowerCase();
      self.iUpdateInt               = dConfig.update_interval;
      self.fOffsetIntTemperature    = dConfig.offset_int_temperature || 0.0;
      self.fOffsetExtTemperature    = dConfig.offset_ext_temperature || 0.0;
      self.fOffsetIntHumidity       = dConfig.offset_int_humidity    || 0.0;

      // Create services and characteristics
      // LogLevel
      self.dcCustomCharacteristic.LogLevel = function ()
      {
         cCharacteristic.call(this, "Log Level", global.cUUIDGen.generate("InkbirdBtTHSensorAccessory.LogLevel"));
         this.setProps(
         {
            format: cCharacteristic.Formats.UINT8,
            maxValue: ELOGLEVEL.MAX,
            minValue: ELOGLEVEL.MIN,
            minStep: 1,
            perms: [cCharacteristic.Perms.READ, cCharacteristic.Perms.WRITE, cCharacteristic.Perms.NOTIFY]
         });
         this.value = 2;
      };
      inherits(self.dcCustomCharacteristic.LogLevel, cCharacteristic);

      // External sensor
      self.dcCustomCharacteristic.ExternalSensor = function ()
      {
         cCharacteristic.call(this, "External Sensor", global.cUUIDGen.generate("InkbirdBtTHSensorAccessory.ExternalSensor"));
         this.setProps(
         {
            format: cCharacteristic.Formats.BOOL,
            perms: [cCharacteristic.Perms.READ, cCharacteristic.Perms.NOTIFY]
         });
         this.value = undefined;
      };
      inherits(self.dcCustomCharacteristic.ExternalSensor, cCharacteristic);

      self.cAccessoryInfo                 = new cService.AccessoryInformation();
      self.cTemperatureService            = new cService.TemperatureSensor(self.strName);
      self.cHumidityService               = new cService.HumiditySensor(self.strName);
      self.cBatteryService                = new cService.BatteryService(self.strName);
      self.cEveHistoryService             = new cFakeGatoHistoryService("weather", this, (dConfig.storage != 'googleDrive' ? { storage: 'fs' } : { storage: 'googleDrive', path: 'homebridge' }));
      
      // Set Noble events
      noble.on('stateChange', state => self.bHWReady = (state === 'poweredOn'));
      noble.on('discover', cPeripheral => self.RunStatemachine(false, true, cPeripheral));

      // Start the autorefresh if configured
      if (self.iUpdateInt != undefined)
      {  // If interval is set then 
         // Set minimum to 5 seconds
         self.iUpdateInt = Math.max(5,self.iUpdateInt);
         self.Log(ELOGLEVEL.INFO, `Update Intervall ${self.iUpdateInt}s.`);
      }
      self.RunStatemachine(false, false, undefined);
      self.Log(ELOGLEVEL.DEBUG, "End Initialization");
   }

   /**
    * Function to get the current temperature of the sensor.
    * 
    * @param {function} fCallback         Callback function pointer to give back the value once you got it
    * @returns {void}                     Nothing (value is given back via callback function) 
    */
   getTemperature(fCallback)
   {
      var self = this;
      self.Log(ELOGLEVEL.DEBUG, `Start getting temperature`);

      // Store callback function and run statemachine
      self.fCallbackTemperature     = fCallback;
      self.bQueryStarted            = true;
      self.RunStatemachine(false, false, undefined);
      return;
   }

   /**
    * Function to update the current temperature of the sensor.
    * 
    * @param {Object} cError              Error. Not used here. Only for equivalent parameters to homebridge callback function
    * @param {boolean} fValue             Value to be set
    * @returns {void}                     Nothing
    */
   updateTemperature(cError, fValue)
   {
      var self = this;

      if (cError == null)
         self.cTemperatureService.updateCharacteristic(global.cCharacteristic.CurrentTemperature, fValue);
      return;
   }
 
    /**
    * Function to get the current relative humidity of the sensor.
    * 
    * @param {function} fCallback         Callback function pointer to give back the value once you got it
    * @returns {void}                     Nothing (value is given back via callback function) 
    */
   getHumidity(fCallback)
   {
      var self       = this;
      self.Log(ELOGLEVEL.DEBUG, `Start getting humidity`);

      // Store callback function and run statemachine
      self.fCallbackHumidity  = fCallback;
      self.bQueryStarted      = true;
      self.RunStatemachine(false, false, undefined);
      return;
   }

   /**
    * Function to update the current relative humidity of the sensor.
    * 
    * @param {Object} cError              Error. Not used here. Only for equivalent parameters to homebridge callback function
    * @param {boolean} fValue             Value to be set
    * @returns {void}                     Nothing
    */
   updateHumidity(cError, fValue)
   {
      var self = this;

      if (cError == null)
         self.cHumidityService.updateCharacteristic(global.cCharacteristic.CurrentRelativeHumidity, fValue);
      return;
   }

   /**
    * Function to get the external sensor flag of the sensor.
    * 
    * @param {function} fCallback         Callback function pointer to give back the value once you got it
    * @returns {void}                     Nothing (value is given back via callback function) 
    */
   getExternalSensor(fCallback)
   {
      var self = this;
      self.Log(ELOGLEVEL.DEBUG, `Start getting external sensor flag`);

      // Store callback function and run statemachine
      self.fCallbackExtSensor = fCallback;
      self.bQueryStarted      = true;
      self.RunStatemachine(false, false, undefined);
      return;
   }

   /**
    * Function to update the external sensor flag of the sensor.
    * 
    * @param {Object} cError              Error. Not used here. Only for equivalent parameters to homebridge callback function
    * @param {boolean} bValue             Value to be set
    * @returns {void}                     Nothing 
    */
   updateExternalSensor(cError, bValue)
   {
      var self = this;

      if (cError == null)
         self.cTemperatureService.updateCharacteristic(self.dcCustomCharacteristic.ExternalSensor, bValue);
      return;
   }

   /**
    * Function to get the battery level of the sensor.
    * 
    * @param {function} fCallback         Callback function pointer to give back the value once you got it
    * @returns {void}                     Nothing (value is given back via callback function) 
    */
   getBatteryLevel(fCallback)
   {
      var self = this;
      self.Log(ELOGLEVEL.DEBUG, `Start getting battery level`);

      // Store callback function and run statemachine
      self.fCallbackBatteryLevel = fCallback;
      self.bQueryStarted         = true;
      self.RunStatemachine(false, false, undefined);
      return;
   }

   /**
    * Function to update the battery level of the sensor.
    * 
    * @param {Object} cError              Error. Not used here. Only for equivalent parameters to homebridge callback function
    * @param {boolean} fValue             Value to be set
    * @returns {void}                     Nothing
    */
   updateBatteryLevel(cError, fValue)
   {
      var self = this;

      if (cError == null)
         self.cBatteryService.updateCharacteristic(global.cCharacteristic.BatteryLevel, fValue);
      return;
   }

   /**
    * Function to get the low battery status of the sensor.
    * 
    * @param {function} fCallback         Callback function pointer to give back the value once you got it
    * @returns {void}                     Nothing (value is given back via callback function) 
    */
   getLowBatteryStatus(fCallback)
   {
      var self = this;
      self.Log(ELOGLEVEL.DEBUG, `Start getting battery low status`);

      // Store callback function and run statemachine
      self.fCallbackLowBattery   = fCallback;
      self.bQueryStarted         = true;
      self.RunStatemachine(false, false, undefined);
      return;
   }

   /**
    * Function to update the low battery status of the sensor.
    * 
    * @param {Object} cError              Error. Not used here. Only for equivalent parameters to homebridge callback function
    * @param {boolean} bValue             Value to be set
    * @returns {void}                     Nothing 
    */
   updateLowBatteryStatus(cError, bValue)
   {
      var self = this;

      if (cError == null)
         self.cBatteryService.updateCharacteristic(global.cCharacteristic.StatusLowBattery, bValue);
      return;
   }

   /**
    * Function to set the log level
    * 
    * @param {number} iLogLevel           New log level to be set
    * @param {function} fCallback         Callback function pointer to give back the value set
    * @returns {void}                     Nothing
    */
   setLogLevel(iLogLevel, fCallback)
   {
      var self = this;
      if (iLogLevel < ELOGLEVEL.MIN)
      {  // Log level to low
         self.Log(ELOGLEVEL.WARNING, `Log level ${iLogLevel} too low. Setting to ${ELOGLEVEL.MIN} (${STRLOGLEVEL[ELOGLEVEL.MIN]}).`)
         self.iLogLevel = ELOGLEVEL.MIN;
      }
      else if (iLogLevel > ELOGLEVEL.MAX)
      {  // Log level to high
         self.Log(ELOGLEVEL.WARNING, `Log level ${iLogLevel} too high. Setting to ${ELOGLEVEL.MAX} (${STRLOGLEVEL[ELOGLEVEL.MAX]}).`)
         self.iLogLevel = ELOGLEVEL.MAX;
      }
      else
      {  // Ok. Always print log
         self.cLog(`Setting log level to ${STRLOGLEVEL[iLogLevel]}.`);
         self.iLogLevel = iLogLevel;
      }

      fCallback(null, self.iLogLevel);
      return;
   }

   /**
    * Function called by homebridge to get the services of the accessory
    * 
    * @returns {Object}                   A list of the available services
    */
   getServices()
   {
      var self = this;
      self.Log(ELOGLEVEL.DEBUG, "Getting available services");

      //-----------------------------------------------------------
      // Accessory Info service
      //------------------------
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.Manufacturer     , "INKBIRD");
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.SerialNumber     , self.strMAC);
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.Identify         , false);
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.Name             , self.strName);
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.Model            , self.strModel);
      self.cAccessoryInfo.setCharacteristic(global.cCharacteristic.FirmwareRevision , global.strFWVersion);

      //-----------------------------------------------------------
      // Temperature service
      //------------------------
      self.cTemperatureService
          .getCharacteristic(global.cCharacteristic.CurrentTemperature)
          .setProps({minValue: -273.15, maxValue: 1000.0})
          .on("get", self.getTemperature.bind(self));
      self.cTemperatureService
          .addCharacteristic(self.dcCustomCharacteristic.ExternalSensor)
          .on("get", self.getExternalSensor.bind(self))

      //-----------------------------------------------------------
      // Humidity service
      //------------------------
      self.cHumidityService
          .getCharacteristic(global.cCharacteristic.CurrentRelativeHumidity)
          .on("get", self.getHumidity.bind(self));
      self.cHumidityService
          .addCharacteristic(self.dcCustomCharacteristic.LogLevel)
          .on("get", (fCallback => fCallback(null, self.iLogLevel)).bind(self))
          .on("set", self.setLogLevel.bind(self));

      //-----------------------------------------------------------
      // Battery service
      //------------------------
      self.cBatteryService
          .getCharacteristic(global.cCharacteristic.BatteryLevel)
          .on("get", self.getBatteryLevel.bind(self));
      self.cBatteryService
          .getCharacteristic(global.cCharacteristic.ChargingState)
          .on("get", (fCallback => fCallback(null, false)).bind(self));
      self.cBatteryService
          .getCharacteristic(global.cCharacteristic.StatusLowBattery)
          .on("get", self.getLowBatteryStatus.bind(self));

      //-----------------------------------------------------------
      // Eve history service
      //------------------------
      // Nothing to do

      return [self.cAccessoryInfo, self.cTemperatureService, self.cHumidityService, self.cBatteryService, self.cEveHistoryService];
   }

   /**
    * Function log a message to the homebridge log if it is important enough
    * 
    * @param {*} iLevel                   Maximum log level that will be logged
    * @param {*} strMessage               Message
    * @returns {void}                     Nothing
    */
   Log(iLevel, strMessage)
   {
      var self = this;

      if (iLevel <= self.iLogLevel)
         self.cLog(`${STRLOGLEVEL[iLevel]} - ${strMessage}`);
      return;
   }

   /**
    * Function parses the status and stores the values.
    * 
    * @returns {void}                     Nothing
    */
   parseStatus()
   {
      var self = this;

      self.fIntTemperature       = undefined;
      self.fExtTemperature       = undefined;
      self.fTemperature          = undefined;
      self.fIntHumidity          = undefined;
      self.bExternalSensor       = undefined;
      self.fBatteryLevel         = undefined;

      // Check if value is present
      if (self.cRawStatus != undefined)
      {  // Calculate CRC16 ModBus
         self.bExternalSensor    = self.cRawStatus.readUIntLE(4, 1) == 1;
         self.fIntHumidity       = (self.cRawStatus.readUIntLE(2, 2) + self.fOffsetIntHumidity)/100;
         if (self.fIntHumidity < 0.0)     self.fIntHumidity = 0.0;
         if (self.fIntHumidity > 100.0)   self.fIntHumidity = 100.0;
         self.fBatteryLevel      = self.cRawStatus.readUIntLE(7, 1);

         if ((self.bDualViewSensor) && (self.bExternalSensor))
         {
            self.fIntTemperature    = (self.cRawStatus.readIntLE(5, 2) + self.fOffsetIntTemperature)/100;
            if (self.fIntTemperature < -273.15) self.fIntTemperature = -273.15;
            self.fExtTemperature    = (self.cRawStatus.readIntLE(0, 2) + self.fOffsetExtTemperature)/100;
            if (self.fExtTemperature < -273.15) self.fExtTemperature = -273.15;
            self.Log(ELOGLEVEL.DEBUG, `Dual view sensor - no CRC, internal temperature ${self.fIntTemperature}°C, external temperature ${self.fExtTemperature}°C, internal relative humidity ${self.fIntHumidity}%`);
            // Store values in for Eve history function
         }
         else {
            self.iCRC               = CRC16_0x18005(self.cRawStatus, 0, 4, true, true, 0xFFFF, 0x0);
            if ((self.dSensorCfg != 0) && (self.iCRC != self.cRawStatus.readUIntLE(5, 2)))
            {
               self.Log(ELOGLEVEL.WARNING, `CRC Error (expected ${self.iCRC.toString(16)}, found ${self.cRawStatus.readUIntLE(5, 2).toString(16)}). Ignoring data!!`)
               return;
            }

            if (self.bExternalSensor)
            {
               self.fIntTemperature    = undefined;
               self.fExtTemperature    = (self.cRawStatus.readIntLE(0, 2) + self.fOffsetExtTemperature)/100;
               if (self.fExtTemperature < -273.15) self.fExtTemperature = -273.15;
            }
            else {
               self.fIntTemperature    = (self.cRawStatus.readIntLE(0, 2) + self.fOffsetIntTemperature)/100;
               if (self.fIntTemperature < -273.15) self.fIntTemperature = -273.15;
               self.fExtTemperature    = undefined;
            }

            self.Log(ELOGLEVEL.DEBUG, `CRC Ok (${self.iCRC.toString(16)}), temperature ${self.fIntTemperature}°C, internal relative humidity ${self.fIntHumidity}%, ${self.bExternalSensor ? `external` : `internal`} sensor`);
         }
         if (self.strSensor == "auto")
            self.fTemperature = self.bExternalSensor ? self.fExtTemperature : self.fIntTemperature;
         else {
            if  (self.strSensor == "internal")
            {
               self.bExternalSensor = false;
               self.fTemperature    = self.fIntTemperature;
            }
            else {
               self.bExternalSensor = true;
               self.fTemperature    = self.fExtTemperature;
            }
         }
         // Store values in for Eve history function
         self.cEveHistoryService.addEntry({ time: moment().unix(), temp: self.fTemperature, humidity: self.fIntHumidity, pressure: 0.0});
         self.Log(ELOGLEVEL.DEBUG, `battery level ${self.fBatteryLevel}%, battery ${self.fBatteryLevel < 10 ? `low` : `ok`}`);

      }
      return;
   }

   /**
    * Function that stops a running timeout
    * 
    * @returns {void}                     Nothing
    */
   stopTimeout()
   {
      var self = this;

      if (self.iTimeoutId != undefined)
      {  // If there's still a timeout running, then stop it
         clearTimeout(self.iTimeoutId);
         self.iTimeoutId = undefined;
      }
      return;
   }

   /**
    * State machine to do the reading / cyclic reading via BLE
    * 
    * @param {boolean} bTimeout           Will be set if the statemachine is run by the runout timeout, otherwise it's false
    * @param {boolean} bDiscover          Will be set if the statemachine is run by the discover of a peripheral
    * @param {Object}  cPeripheral        Object with the data of the discovered peripheral
    * @returns {void}                     Nothing
    */
   RunStatemachine(bTimeout, bDiscover, cPeripheral)
   {
      var self = this;

      if (bTimeout)
         self.stopTimeout();

      if ((!self.bHWReady) && (self.eState != ESTATES.NOT_READY))
      {  // If hardware not ready, then reset
         self.Log(ELOGLEVEL.FATAL, `Bluetooth low energy hardware went off`);
         noble.stopScanning();
         self.eState = ESTATES.NOT_READY;
      }

      do
      {  // Store actual state to see any change later
         self.eOldState = self.eState;
         // The state machine
         switch (self.eState)
         {
            case ESTATES.NOT_READY:
               // The bluetooth hardware is not ready
               self.stopTimeout();

               if (self.bHWReady)
               {  // If the hardware is ready, go to status invalid
                  self.Log(ELOGLEVEL.DEBUG, `Bluetooth low energy hardware powered on`);
                  self.eState       = ESTATES.STATUS_INVALID;
               }
               else
               {  // If the hardware is not ready, then try again later (5s)
                  self.Log(ELOGLEVEL.WARNING, `Waiting for bluetooth low energy hardware to power on`);
                  self.iTimeoutId   = setInterval(self.RunStatemachine.bind(self), 5000, true, false, undefined);
               }
               break;

            case ESTATES.STATUS_INVALID:
               // The status is invalid
               self.stopTimeout();

               if ((self.bQueryStarted) || (self.iUpdateInt != undefined))
               {  // If a callback is waiting to be answered, or the auto-update is enabled, then start scanning (Timeout 5s)
                  self.Log(ELOGLEVEL.DEBUG, `Start scanning for bluetooth sensor`);
                  noble.startScanning();
                  self.iTimeoutId   = setInterval(self.RunStatemachine.bind(self), 15000, true, false, undefined);
                  self.eState       = ESTATES.SCANNING;
               }
               break;

            case ESTATES.SCANNING:
               // Bluetooth adapter is scanning

               // Reset Status
               self.cRawStatus   = undefined;

               if ((bDiscover) && (self.dSensorCfg != undefined))
               {  // Discover - found a BLE device
                  if ((cPeripheral.address === self.strMAC) || (self.strMAC == ""))
                  {  // If MAC-address fits, or MAC not set
                     // Plausibility check
                     if ((self.dSensorCfg == 0) ||
                        ((cPeripheral.advertisement.manufacturerData.length  == self.dSensorCfg.datalength) &&
                         (cPeripheral.advertisement.localName                == self.dSensorCfg.localName) && 
                         (cPeripheral.advertisement.serviceDat               == self.dSensorCfg.serviceDat) && 
                         (cPeripheral.advertisement.serviceUuids             == self.dSensorCfg.serviceUuids)))
                     {  // If type is invalid, no check possible but let it through to easily support new compatible types
                        // Otherwise check the values for plausibility
                        // Store manufacturer data
                        self.cRawStatus   = cPeripheral.advertisement.manufacturerData;
                        self.Log(ELOGLEVEL.INFO, `Peripheral with MAC ${cPeripheral.address} found - stop scanning`);
                        self.Log(ELOGLEVEL.DEBUG,`ManufacturerData is ${self.cRawStatus.toString('hex')}`);
                     }
                     else if (self.strMAC != "")
                     {
                        let strExpected = `(${self.dSensorCfg.datalength}, ${self.dSensorCfg.localName}, ${JSON.stringify(self.dSensorCfg.serviceDat, null, 2)}, ${self.dSensorCfg.serviceUuids})`;
                        let strFound = `(${cPeripheral.advertisement.manufacturerData.length}, ${cPeripheral.advertisement.localName}, ${JSON.stringify(cPeripheral.advertisement.serviceDat, null, 2)}, ${cPeripheral.advertisement.serviceUuids})`;
                        self.Log(ELOGLEVEL.ERROR, `Peripheral with MAC ${cPeripheral.address} found, but plausibility check failed. Expected ${strExpected}, but found ${strFound}`);
                     }
                  }
               }

               if ((bTimeout) || (self.cRawStatus != undefined))
               {  // Timeout or finished

                  if (self.cRawStatus == undefined)
                     self.Log(ELOGLEVEL.WARNING, `Peripheral NOT found - stop scanning`);

                  // Stop scanning
                  noble.stopScanning();
                  self.stopTimeout();

                  // Store manufacturer data, update Apple Home and set query finished 
                  self.parseStatus();
                  self.fCallbackTemperature  = self.fCallbackTemperature   || self.updateTemperature;
                  self.fCallbackHumidity     = self.fCallbackHumidity      || self.updateHumidity;
                  self.fCallbackExtSensor    = self.fCallbackExtSensor     || self.updateExternalSensor;
                  self.fCallbackBatteryLevel = self.fCallbackBatteryLevel  || self.updateBatteryLevel;
                  self.fCallbackLowBattery   = self.fCallbackLowBattery    || self.updateLowBatteryStatus;
                  self.bQueryStarted   = false;

                  // start timeout for validity of data and go to next state
                  self.iTimeoutId      = setInterval(self.RunStatemachine.bind(self), (self.iUpdateInt || 10) * 1000, true, false, undefined);
                  self.eState          = ESTATES.READY4ANSWER;
               }

               break;

            case ESTATES.READY4ANSWER:
               // Status is read or device unreachable

               // Do all the callbacks
               if (self.fCallbackTemperature != undefined)
               {  // Temperature callback
                  self.Log(ELOGLEVEL.INFO, `Sending temperature ${self.fTemperature}°C`);
                  self.fCallbackTemperature(null, self.fTemperature);
                  self.fCallbackTemperature = undefined;
               }
               if (self.fCallbackHumidity != undefined)
               {  // Humidity callback
                  self.Log(ELOGLEVEL.INFO, `Sending relative humidity ${self.fIntHumidity}%`);
                  self.fCallbackHumidity(null, self.fIntHumidity);
                  self.fCallbackHumidity = undefined;
               }
               if (self.fCallbackExtSensor != undefined)
               {  // External sensor callback
                  self.Log(ELOGLEVEL.INFO, self.bExternalSensor ? `Sending external sensor` : `Sending internal sensor`);
                  self.fCallbackExtSensor(null, self.bExternalSensor);
                  self.fCallbackExtSensor = undefined;
               }
               if (self.fCallbackBatteryLevel != undefined)
               {  // BatteryLevel callback
                  self.Log(ELOGLEVEL.INFO, `Sending battery level ${self.fBatteryLevel}%`);
                  self.fCallbackBatteryLevel(null, self.fBatteryLevel);
                  self.fCallbackBatteryLevel = undefined;
               }
               if (self.fCallbackLowBattery != undefined)
               {  // Low battery callback
                  self.Log(ELOGLEVEL.INFO, self.fBatteryLevel < 10 ? `Sending battery low` : `Sending battery ok`);
                  self.fCallbackLowBattery(null, self.fBatteryLevel < 10);
                  self.fCallbackLowBattery = undefined;
               }

               // After valid time for value or if new query started go back to invalid
               // If we already have values from cyclic update, this bQueryStarted will lead to an extra update.
               // In this way it's possible to get updated values even though you have the cyclic feature activated.
               if ((bTimeout) || (self.bQueryStarted))
                  self.eState = ESTATES.STATUS_INVALID;
               break;
         }
         bTimeout  = false;
         bDiscover = false;
      }
      // when state changed, then run it again
      while (self.eState != self.eOldState);

      return;
   }
}

//-----------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------

module.exports = cInkbirdBtTHSensorAccessory;
