var stdio = require('stdio');

// check command line options
var ops = stdio.getopt({
    'check': {key: 'c', args: 2, description: 'What this option means'},
    'map': {key: 'm', description: 'Another description'},
    'kaka': {args: 1, mandatory: true},
    'ooo': {key: 'o'}
});

var request = require('request');
var crypto = require('crypto');
var atmosphere = require('atmosphere-client');
var switchItem = require(".switchItem.js").switchItem;
var types = require("./accessories/types.js")

var storage = require('node-persist');
var accessory_Factor = new require("./Accessory.js");
var accessoryController_Factor = new require("./AccessoryController.js");
var service_Factor = new require("./Service.js");
var characteristic_Factor = new require("./Characteristic.js");
var bridge_Factor = new require("./BridgedAccessoryController.js");

console.log("HAP-NodeJS OpenHAB Bridge starting...");
storage.initSync();

var bridgeController = new bridge_Factor.BridgedAccessoryController();
var targetPort = 52826;
var bridgeName = "OpenHAB HomeKit Bridge";
var pincode = "031-45-154";

registerOpenHABAccessories();


function registerOpenHABAccessories() {
  request('http://192.168.0.99:8080/rest/items?type=json', function (error, response, body) {
    if (!error && response.statusCode == 200) {
      publishOpenHABBridgeAccessory(body);
    }
  });
}

// iterate all items and create HAP compatible objects
function publishOpenHABBridgeAccessory(JSONChunk) {
  var items = JSON.parse(JSONChunk).item;
  var openHABswitchItems = items.filter(function filterSwitchItems(value) {
    return value.type === "SwitchItem";
  });

  for (var i = 0; i < openHABswitchItems.length; i++) {
    var openHABSwitchItem = openHABswitchItems[i];
    var switchItemTemplate = JSON.parse(JSON.stringify(switchItem));
    var accessoryController = publishAccessory(switchItemTemplate, openHABSwitchItem);
    bridgeController.addAccessory(accessoryController);
  }

  var accessory = new accessory_Factor.Accessory(
    bridgeName,
    generateUniqueUsername(bridgeName),
    storage,
    parseInt(targetPort),
    pincode,
    bridgeController);
  accessory.publishAccessory();
}

function getService(accessory, type) {
  return accessory.services.filter( function(value) {
    return value.sType === type;
  })[0];
}

function getNameCharacteristic(service) {
  return service.characteristics.filter(function (value) {
    return value.cType === types.NAME_CTYPE;
  })[0];
}

function getPowerStateCharacteristic(service) {
  return service.characteristics.filter(function (value) {
    return value.cType === types.POWER_STATE_CTYPE;
  })[0];
}

function generateUniqueUsername(name) {
  var shasum = crypto.createHash('sha1')
  shasum.update(name);
  var hash = shasum.digest('hex');

  return "" +
    hash[0] + hash[1] + ':' +
    hash[2] + hash[3] + ':' +
    hash[4] + hash[5] + ':' +
    hash[6] + hash[7] + ':' +
    hash[8] + hash[9] + ':' +
    hash[10] + hash[11];
}

function publishAccessory(template, openHABSwitchItem) {
  var name = openHABSwitchItem.name;
  var url = openHABSwitchItem.link;

  var informationService = getService(template, types.ACCESSORY_INFORMATION_STYPE);
  var nameCharacteristic = getNameCharacteristic(informationService);
  nameCharacteristic.initialValue = name;

  var lightBulbService = getService(template, types.LIGHTBULB_STYPE);
  var nameCharacteristic = getNameCharacteristic(lightBulbService);
  nameCharacteristic.initialValue = name;

  var powerStateCharacteristic = getPowerStateCharacteristic(lightBulbService);

  powerStateCharacteristic.onUpdate = function (value) {
    var command = value ? 'ON' : 'OFF';
    request.post(
        url,
        { body: command },
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                console.log(body)
            }
        }
    );
  };

  var accessoryController = new accessoryController_Factor.AccessoryController();
  for (var j = 0; j < template.services.length; j++) {
      var service = new service_Factor.Service(template.services[j].sType);

      //loop through characteristics
      for (var k = 0; k < template.services[j].characteristics.length; k++) {
          var characteristicTemplate = template.services[j].characteristics[k];
          var options = {
              type: characteristicTemplate.cType,
              perms: characteristicTemplate.perms,
              format: characteristicTemplate.format,
              initialValue: characteristicTemplate.initialValue,
              supportEvents: characteristicTemplate.supportEvents,
              supportBonjour: characteristicTemplate.supportBonjour,
              manfDescription: characteristicTemplate.manfDescription,
              designedMaxLength: characteristicTemplate.designedMaxLength,
              designedMinValue: characteristicTemplate.designedMinValue,
              designedMaxValue: characteristicTemplate.designedMaxValue,
              designedMinStep: characteristicTemplate.designedMinStep,
              unit: characteristicTemplate.unit,
          }
          var characteristic =
            new characteristic_Factor.Characteristic(options, characteristicTemplate.onUpdate);

          if (options.type === types.POWER_STATE_CTYPE) {
            updateCharacteristicsValue(url, characteristic);
          }
          service.addCharacteristic(characteristic);
      };

      accessoryController.addService(service);
  }

  return accessoryController;
}

function updateCharacteristicsValue(url, characteristic) {
  var request = new atmosphere.AtmosphereRequest();
  request.url = url + '/state?type=json';
  request.transport = 'long-polling';

  request.onMessage = function(response) {
    console.log('message: ' + response.responseBody);
    characteristic.updateValue(response.responseBody === 'ON' ? true : false);
  };

  atmosphere.subscribe(request);
};