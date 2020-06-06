# homebridge-inkbird-bt-thsensor
A homebridge-plugin for the Inkbird bluetooth temperature- and humidity-sensors.

### Features:
- Temperature
- Humidity
- Supported sensors:
   - IBS-TH1

## Installation:

### 1. Install homebridge and inkbird-bt-thsensor plugin.
- 1.a `sudo npm install -g homebridge --unsafe-perm`
- 1.b `sudo npm install -g homebridge-inkbird-bt-thsensor`
- 1.c 'sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)'

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
      "accessory"   : "InkbirdBtTHSensor",
      "name"        : "Garden TH Sensor",
      "plugin_map"  :
      {
         "plugin_name" : "homebridge-inkbird-bt-thsensor"
      },
      "model"          : "IBS-TH1",
      "mac_address"    : "50:51:A9:7D:FC:E9",
      "update_interval": 300
   }
]
```
