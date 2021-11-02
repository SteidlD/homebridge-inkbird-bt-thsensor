# homebridge-inkbird-bt-thsensor
A homebridge-plugin for the Inkbird bluetooth temperature- and humidity-sensors.

### Features:
- Temperature (with Eve history)
- Humidity (with Eve histor)
- Battery level
- Supported sensors:
   - IBS-TH1

## Installation:

### 1. Install homebridge and inkbird-bt-thsensor plugin.
- 1.a `sudo npm install -g homebridge --unsafe-perm`
- 1.b `sudo npm install -g homebridge-inkbird-bt-thsensor`
- 1.c `sudo setcap cap_net_raw+eip $(eval readlink -f ``which node``)`

The command 1.c grants the node binary cap_net_raw privileges, so it can start/stop BLE advertising.
Note: The command requires setcap to be installed. It can be installed the following way:
```
    apt: sudo apt-get install libcap2-bin
    yum: su -c \'yum install libcap2-bin\'
```

### 2. Update homebridge configuration file.
```
"accessories": [
   {
      "accessory"       : "InkbirdBtTHSensor",
      "plugin_map"      :
      {
         "plugin_name": "homebridge-inkbird-bt-thsensor",
         "index": 0
      },
      "name"            : "Garden TH Sensor",
      "model"           : "IBS-TH1",
      "mac_address"     : "50:51:A9:7D:FC:E9",
      "update_interval" : 600,
      "storage"         : "filesystem",
      "loglevel"        : 3
   }
]
```

- name            (required): Choose a suitable name for your sensor accessory.
- model           (required): Choose a type from list of supported types above.
                              If your type is not available, but you want to try if your sensor works anyway put
                              `not in list - try it anyway`
                              You won't get an error that the sensor is wrong and plausibility and CRC checks will be switched off.
                              But be warned, you might get very strange values!!!
- mac_address     (optional): Put the MAC-address of the sensor if you know it.
                              If not, leave the value open and the plugin will choose any sensor it finds that passes the plausibility checks. In the log you will get a message like this:
                              `7/6/2020 12:39:05 [Garden TH Sensor] Peripheral with MAC 50:51:a9:7d:fc:e9 found - stop scanning`
                              There you have your MAC. Copy it to your configuration in this format ("xx:xx:xx:xx:xx:xx") to lock only to this sensor.
- update_interval (optional): If you specify an update interval (in seconds) the plugin will automatically refresh the values so you have
                              a faster response for your value. Also you need to configure this option, if you want the Eve history to be
                              filled with values. But be advised that this might reduce your batteries lifetime, so don't choose it too short.
- storage         (optional): Where do you want the Eve history to be stored (`filesystem` (default) or `googleDrive` (not tested)).
- loglevel        (optional): The log level at start of the plugin - smaller numbers lead to less messages
                              (0 = Fatal, 1 = Error, 2 = Warning, 3 = Info (default), 4 = Debug).

### 3. New sensor types
If you have an Inkbird Bluetooth sensor other than the IBS-TH1 please try it out using the `not in list - try it anyway` or the `IBS-TH1` setting for the model parameter. If the sensor works -> fine, if not set your log level to 4 (debug) and you'll see a
debug message somewhat like `Debug - ManufacturerData is 9c077215005be33f08`. Try finding out the protocol by heating up / cooling down the sensor and checking which values change. You can also use the original app to compare the temperature and the ManufacturerData. The protocol of the `IBS-TH1` you find in index.js

And here I'm depending on your help as I only have the `IBS-TH1`. Please let me know everything about new sensors, like:
- Hey, the sensor xyz works with the `IBS-TH1` setting 
- or... the protocol of abc seems to be the following

and I will update the plugin so more people can use it. Thanks a lot 
