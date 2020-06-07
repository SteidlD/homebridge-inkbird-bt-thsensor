// Implements the InkbirdBtTHSensorAccessory class that manages the bluetooth sensor
//
//-----------------------------------------------------------------------
// Date        Author      Change
//-----------------------------------------------------------------------
// 04.06.2020  D.Steidl    Created
// 06.06.2020  D.Steidl    First working version
// 07.06.2020  D. Steidl   CRC16 Modbus, plausibility checks and easy to configure features implemented
//-----------------------------------------------------------------------

//-----------------------------------------------------------------------
// Global variables
//-----------------------------------------------------------------------

// variables have to be declared explicitly
'use strict'

/** @const {Object} ESTATES               Enumeration for state machine */
const ESTATES = {NOT_READY: 1, STATUS_INVALID: 2, SCANNING: 3, READY4ANSWER: 4}
/** @const {Object} DDMODELS              Dictionary of models containing a dictionary with the config data of a model */
const DDMODELS = {"IBS-TH1" : {datalength : 9, localName : "sps", serviceDat : undefined, serviceUuids : "fff0"}}

//-----------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------

// from JavaScript
const noble = require('@abandonware/noble/index');

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
      cLog("Start Initialization");

      // Store and initialize values
      self.cLog                  = cLog;
      self.dConfig               = dConfig;
      self.cRawStatus            = undefined;                                                      // Cached raw status from doCyclicGetStatus
      self.fTemperature          = undefined;                                                      // Temperature in degree Celsius
      self.fHumidity             = undefined;                                                      // Relative humidity in %
      self.bExternalSensor       = undefined;                                                      // true, if external sensor is connected
      self.fBatteryLevel         = undefined;                                                      // Battery level in %
      self.eState                = ESTATES.NOT_READY;                                              // State of the state machine (Hardware not ready)
      self.iTimeoutId            = undefined;                                                      // Id of a started timeout to find it again (No Timeout started yet)
      self.fCallbackTemperature  = undefined;                                                      // Callback for temperature
      self.fCallbackHumidity     = undefined;                                                      // Callback for humidity
      self.fCallbackExtSensor    = undefined;                                                      // Callback for external sensor
      self.fCallbackBatteryLevel = undefined;                                                      // Callback for battery level
      self.fCallbackLowBattery   = undefined;                                                      // Callback for low battery
      self.bQueryStarted         = false;                                                          // true if a query was started to read a value
      self.bHWReady              = false;                                                          // Shows if hardware is ready

      // Analyse config, use config first, if not set then fall back to default values
      self.strName               = dConfig.name;
      self.strModel              = dConfig.model || "";
      self.dSensorCfg            = DDMODELS[self.strModel];
      if ((self.dSensorCfg == undefined) && (self.strModel != "not in list - try it anyway"))
         self.cLog(`Invalid sensor type ${self.strModel}. See README.md for valid types!`);
      self.strMAC                = (dConfig.mac_address || "").toLowerCase();
      self.iUpdateInt            = dConfig.update_interval;

      // Create services
      self.cAccessoryInfo        = new cService.AccessoryInformation();
      self.cTemperatureService   = new cService.TemperatureSensor(self.strName);
      self.cHumidityService      = new cService.HumiditySensor(self.strName);
      self.cBatteryService       = new cService.BatteryService(self.strName);

      // Set Noble events
      noble.on('stateChange', state => self.bHWReady = (state === 'poweredOn'));
      noble.on('discover', cPeripheral => self.RunStatemachine(false, true, cPeripheral));

      // Start the autorefresh if configured
      if (self.iUpdateInt != undefined)
      {  // If interval is set then 
         // Set minimum to 5 seconds
         self.iUpdateInt = Math.max(5,self.iUpdateInt);
         self.cLog(`Update Intervall ${self.iUpdateInt}`);
      }
      self.RunStatemachine(false, false, undefined);
      self.cLog("End Initialization");
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
      self.cLog(`Start getting temperature`);

      // Store callback function and run statemachine
      self.fCallbackTemperature = fCallback;
      self.bQueryStarted = true;
      self.RunStatemachine(false, false, undefined);
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
      self.cLog(`Start getting humidity`);

      // Store callback function and run statemachine
      self.fCallbackHumidity = fCallback;
      self.bQueryStarted = true;
      self.RunStatemachine(false, false, undefined);
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
      self.cLog(`Start getting battery level`);

      // Store callback function and run statemachine
      self.fCallbackBatteryLevel = fCallback;
      self.bQueryStarted = true;
      self.RunStatemachine(false, false, undefined);
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
      self.cLog(`Start getting battery low status`);

      // Store callback function and run statemachine
      self.fCallbackLowBattery = fCallback;
      self.bQueryStarted = true;
      self.RunStatemachine(false, false, undefined);
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
      self.cLog("Getting available services");

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
          .on("get", self.getTemperature.bind(self));

      //-----------------------------------------------------------
      // Humidity service
      //------------------------
      self.cHumidityService
          .getCharacteristic(global.cCharacteristic.CurrentRelativeHumidity)
          .on("get", self.getHumidity.bind(self));

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

      return [self.cAccessoryInfo, self.cTemperatureService, self.cHumidityService, self.cBatteryService];
   }

   /**
    * Function parses the status and stores the values.
    * 
    * @returns {void}                     Nothing
    */
   parseStatus()
   {
      var self = this;

      self.fTemperature          = undefined;
      self.fHumidity             = undefined;
      self.bExternalSensor       = undefined;
      self.fBatteryLevel         = undefined;

      // Check if value is present
      if (self.cRawStatus != undefined)
      {  // Calculate CRC16 ModBus
         self.iCRC               = CRC16_0x18005(self.cRawStatus, 0, 4, true, true, 0xFFFF, 0x0);
         if ((self.dSensorCfg != undefined) && (self.iCRC != self.cRawStatus.readUIntLE(5, 2)))
         {
            self.cLog(`CRC Error (expected ${self.iCRC.toString(16)}, found ${self.cRawStatus.readUIntLE(5, 2).toString(16)}). Ignoring data!!`)
            return;
         }

         self.cLog(`CRC Ok (${self.iCRC.toString(16)})`)
         self.fTemperature       = self.cRawStatus.readUIntLE(0, 2)/100;
         self.fHumidity          = self.cRawStatus.readUIntLE(2, 2)/100;
         self.bExternalSensor    = self.cRawStatus.readUIntLE(4, 1) == 1;
         self.fBatteryLevel      = self.cRawStatus.readUIntLE(7, 1);
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
         self.cLog(`Bluetooth low energy hardware went off`);
         noble.stopScanning();
         self.eState = ESTATES.NOT_READY;
      }

      // The state machine
      switch (self.eState)
      {
         case ESTATES.NOT_READY:
            // The bluetooth hardware is not ready
            self.stopTimeout();

            if (self.bHWReady)
            {  // If the hardware is ready, go to status invalid
               self.cLog(`Bluetooth low energy hardware powered on`);
               self.eState       = ESTATES.STATUS_INVALID;
            }
            else
            {  // If the hardware is not ready, then try again later (5s)
               self.cLog(`Waiting for bluetooth low energy hardware to power on`);
               self.iTimeoutId   = setInterval(self.RunStatemachine.bind(self), 5000, true, false, undefined);
            }
            break;

         case ESTATES.STATUS_INVALID:
            // The status is invalid
            self.stopTimeout();

            if ((self.bQueryStarted) || (self.iUpdateInt != undefined))
            {  // If a callback is waiting to be answered, or the auto-update is enabled, then start scanning (Timeout 5s)
               self.cLog(`Start scanning for bluetooth sensor`);
               noble.startScanning();
               self.iTimeoutId   = setInterval(self.RunStatemachine.bind(self), 15000, true, false, undefined);
               self.eState       = ESTATES.SCANNING;
            }
            break;

         case ESTATES.SCANNING:
            // Bluetooth adapter is scanning

            // Reset Status
            self.cRawStatus   = undefined;

            if (bDiscover)
            {  // Discover - found a BLE device
               if ((cPeripheral.address === self.strMAC) || (self.strMAC == ""))
               {  // If MAC-address fits, or MAC not set
                  // Plausibility check
                  if ((self.dSensorCfg == undefined) ||
                      ((cPeripheral.advertisement.manufacturerData.length  == self.dSensorCfg.datalength) &&
                       (cPeripheral.advertisement.localName                == self.dSensorCfg.localName) && 
                       (cPeripheral.advertisement.serviceDat               == self.dSensorCfg.serviceDat) && 
                       (cPeripheral.advertisement.serviceUuids             == self.dSensorCfg.serviceUuids)))
                  {  // If type is invalid, no check possible but let it through to easily support new compatible types
                     // Otherwise check the values for plausibility
                     // Store manufacturer data
                     self.cRawStatus   = cPeripheral.advertisement.manufacturerData;
                     self.cLog(`Peripheral with MAC ${cPeripheral.address} found - stop scanning`);
                  }
                  else if (self.strMAC != "")
                  {
                     self.cLog(`Peripheral with MAC ${cPeripheral.address} found, but plausibility check failed. Expected (sps, undefined, fff0), but found (${cPeripheral.advertisement.localName}, ${JSON.stringify(cPeripheral.advertisement.serviceDat, null, 2)}, ${cPeripheral.advertisement.serviceUuids})`);
                  }
               }
            }

            if ((bTimeout) || (self.cRawStatus != undefined))
            {  // Timeout or finished

               if (self.cRawStatus == undefined)
                  self.cLog(`Peripheral NOT found - stop scanning`);

               // Stop scanning
               noble.stopScanning();
               self.stopTimeout();

               // Store manufacturer data and go to next state
               self.parseStatus();
               self.iTimeoutId   = setInterval(self.RunStatemachine.bind(self), (self.iUpdateInt || 10) * 1000, true, false, undefined);
               self.eState       = ESTATES.READY4ANSWER;
               // Intended run-through!! No break
            }
            else
               break;

         case ESTATES.READY4ANSWER:
            // Status is read or device unreachable

            // Do all the callbacks
            if (self.fCallbackTemperature != undefined)
            {  // Temperature callback
               self.cLog(`Sending temperature ${self.fTemperature}°C`);
               self.fCallbackTemperature(null, self.fTemperature);
               self.fCallbackTemperature = undefined;
            }
            if (self.fCallbackHumidity != undefined)
            {  // Humidity callback
               self.cLog(`Sending relative humidity ${self.fHumidity}%`);
               self.fCallbackHumidity(null, self.fHumidity);
               self.fCallbackHumidity = undefined;
            }
            if (self.fCallbackExtSensor != undefined)
            {  // External sensor callback
               self.cLog(self.bExternalSensor ? `Sending external sensor` : `Sending internal sensor`);
               self.fCallbackExtSensor(null, self.bExternalSensor);
               self.fCallbackExtSensor = undefined;
            }
            if (self.fCallbackBatteryLevel != undefined)
            {  // BatteryLevel callback
               self.cLog(`Sending battery level ${self.fBatteryLevel}%`);
               self.fCallbackBatteryLevel(null, self.fBatteryLevel);
               self.fCallbackBatteryLevel = undefined;
            }
            if (self.fCallbackLowBattery != undefined)
            {  // Low battery callback
               self.cLog(self.fBatteryLevel < 10 ? `Sending battery low` : `Sending battery ok`);
               self.fCallbackLowBattery(null, self.fBatteryLevel < 10);
               self.fCallbackLowBattery = undefined;
            }

            // All callbacks done
            self.bQueryStarted = false;            

            // After valid time for value go back to invalid
            if (bTimeout)
               self.eState = ESTATES.STATUS_INVALID;
            break;
      }
      return;
   }
}

//-----------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------

module.exports = cInkbirdBtTHSensorAccessory;
