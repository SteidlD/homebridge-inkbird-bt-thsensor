// Main file for plugin
//
//-----------------------------------------------------------------------
// Date        Author      Change
//-----------------------------------------------------------------------
// 24.05.2020  D. Steidl   Created
// 04.06.2020  D. Steidl   Implemented
// 07.06.2020  D. Steidl   CRC16 Modbus implemented
// 14.06.2020  D. Steidl   Added Eve history for temperature and relative humidity
//-----------------------------------------------------------------------

// The Inkbird bluetooth thermo-/hygrometer IBS-TH1 is a bluetooth low energy "peripheral" device. It's using the following protocol:
// - The sensor is sending cyclic advertising frames on channels 37,38,39
// - If the master wants to read out the actual temperature / humidity value it can simply send a scan request
// - The sensor answers with a scan response: 
//    - Device name:
//       o 0x04   (length in bytes)
//       o 0x09   (type of data is device name)
//       o "sps"  (data)
//    - Data:
//       o 0x0A   (length in bytes)
//       o 0xFF   (manufacturer specific)
//       o 0xtttt (temperature in 0,01°C)
//       o 0xhhhh (humidity in 0,01%)
//       o 0xss   (sensor: 0x00 internal sensor, 0x01 external sensor)
//       o 0xcccc (CRC16_MODBUS: polynomial 0x18005, initial value 0xFFFF, input and result reflected, no final xor, data: 0xtt 0xtt 0xhh 0xhh 0xss)
//       o 0xbb   (battery value in %)
//       o 0x08   (no idea what that means - never changes)
// - for configuration or read out of history data a BTLE connection is established
//    - the sensor reports the services / characteristics: 
//       o 0x1800: Generic access (sps)
//       o 0x1801: Generic attibute
//       o 0x180A: Device information
//          o 0x2A23: System ID (0xE9-FC-7D-00-00-A9-51-50)
//          o 0x2A24: Model Number String ("Model Number")
//          o 0x2A25: Serial Number String ("Serial Number")
//          o 0x2A26: Firmware Revision String ("Firmware Revision")
//          o 0x2A27: Hardware Revision String ("Hardware Revision")
//          o 0x2A28: Software Revision String ("1-1")
//          o 0x2A29: Manufacturer Revision String ("INKBIRD")
//          o 0x2A2A: IEEE 11073-20601 Regulatory Certification Data List (0xFE-00-65-78-70-65-72-69-6D-65-6E-74-61-6C)
//          o 0x2A50: PnP ID (0x01-0D-00-00-00-10-01)
//       o 0xFFF0: manufacturer specific
//          o 0xFFF1: cfg data, read-write (0x00-00-00-00 00-00-00-3c 00-00-00-31 2d-37-5a-4b 00-00-00-00)
//          o 0xFFF2: real time data, read-only
//             o 0xtttt (temperature in 0,01°C)
//             o 0xhhhh (humidity in 0,01%)
//             o 0xss   (sensor: 0x00 internal sensor, 0x01 external sensor)
//             o 0xcccc (CRC-16: polynomial 0x18005, initial value 0xFFFF, input and result reflected, no final xor, data: 0xtt 0xtt 0xhh 0xhh 0xss)
//          o 0xFFF3: cfg data 2, read-write
//          o 0xFFF4: measure, read-only
//          o 0xFFF5: recorder frame, read-only
//          o 0xFFF6: history data, notify
//          o 0xFFF7: run/stop recorder, read-write
//          o 0xFFF8: his data type, read-write
//          o 0xFFF9: reset: write-only (06 = reset?)
//
// - entering configuration:
//    - scanning of service/characteristic structure
//    - service 0x1801 turn on indication
//    - read out config and real time data (especially read minimum 9 times 0xFFF2)
//    - read device name
//    - write 06 to 0xFFF9 (reset?)
//
// - reading history
//    - writing cfg data: 0x00-00-00-00 00-00-00-78 00-00-00-31 2d-37-5e-4f 00-00-00-00
//    - read back and check cfg data
//    - write 06 to 0xFFF9 (reset?)

//-----------------------------------------------------------------------
// Global variables
//-----------------------------------------------------------------------

// variables have to be declared explicitly
'use strict'

/** @type {Object}     Pointer to Homebridge.hap.Service */
var cService;
/** @type {Object}     Pointer to Homebridge.hap.Characteristic */
var cCharacteristic;                                                                               
/** @type {Object}     Pointer to Homebridge.hap.uuid */
var cUUIDGen;                                                                                      
/** @type {String}     FW-Version of the plugin (shown in Homekit) */
var strFWVersion;                                                                                  
//-----------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------

// from JavaScript

// from InkbirdBtThermohumiditySensor
const cInkbirdBtTHSensorAccessory   = require('./InkbirdBtTHSensorAccessory')
const packageJson                   = require('./package.json')
var   cFakeGatoHistoryService;

//-----------------------------------------------------------------------
// Classes 
//-----------------------------------------------------------------------

//-----------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------

/**
 * Anonymous function called by homebridge
 * 
 * @param {Object} cHomebridge            Pointer to homebridge object
 * @returns {void}                        nothing
 */
module.exports = function (cHomebridge)
{
   // get version from package
   global.strFWVersion              = packageJson.version;
   // require here because of need to call with cHomebridge argument
   global.cFakeGatoHistoryService   = require('fakegato-history')(cHomebridge);

   console.log("Homebridge API version: " + cHomebridge.version + " InkbirdBtTHSensor V" + global.strFWVersion);

   // Service and Characteristic are from hap-nodejs
   global.cService         = cHomebridge.hap.Service;
   global.cCharacteristic  = cHomebridge.hap.Characteristic;
   global.cUUIDGen         = cHomebridge.hap.uuid;
 
   // For platform plugin to be considered as dynamic platform plugin,
   // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
   cHomebridge.registerAccessory(packageJson.name, "InkbirdBtTHSensor", cInkbirdBtTHSensorAccessory);
}
