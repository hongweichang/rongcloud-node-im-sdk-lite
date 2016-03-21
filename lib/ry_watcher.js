'use strict';
var co = require('co');
var WebSocket = require('ws');
var request = require('request');
var Modules = require('./protobuf.js');

function RYWatcher(userInfo, appId){
  var self = this;
  self.userInfo = userInfo;
  self.appId = appId;
  self.publishMessageCount = 0;

  co(function *(){
    return self.serverNav();
  }).then(function(body){
    var url = `ws://${body.server}/websocket?appId=${self.appId}&token=${encodeURIComponent(self.userInfo.token)}&sdkVer=2.0.6&apiVer=` + Math.floor(Math.random() * 1e6);
    self.socket = new WebSocket(url);
    self.socket.binaryType = 'arraybuffer';

    self.socket.on('open', function(){
      // 开启定时心跳包
      self.heatbeats = setInterval(self.send.bind(self, self.genMsg('PingReqMessage')), 180000);
    });

    self.socket.on('message', function(data){
      self.log('📣  Recieve message type: ', data[0]);
      var type = (data[0] >> 4) & 15;
      self.handleMsg(type, data);
    });
  });
}


RYWatcher.prototype.genMsg = function(type, params){
  var self = this;
  switch(type){
    case 'QueryMessage':
      var partType = [82, 0, 7, 112, 117, 108, 108, 77, 115, 103];
      var partEnd =  [0, 1, 8, 0, 16, 0, 32, 1];
      var userCode = Array.prototype.map.call(self.userInfo.user_id, function(val){
        return val.charCodeAt(0);
      });
      var partUser = [0, userCode.length].concat(userCode);
      return [].concat(partType, partUser, partEnd);
      break;
    case 'QueryConMessage':
      return [112, 0, 1];
      break;
    case 'PubAckMessage':
      return [64, 0, ++self.publishMessageCount];
      break;
    case 'PingReqMessage':
      return [-64];
      break;
  }
};

RYWatcher.prototype.send = function(val){
  var binary = new Int8Array(val);
  this.socket.send(binary.buffer);
};


RYWatcher.prototype.handleMsg = function (type, data){
  var self = this;
  switch(type){
    // ConnAckMessage
    case 2:
      if(data[0] !== 32){
        return self.log('🚨 🚨 🚨 🚨 🚨 🚨 🚨  认证失败 🚨 🚨 🚨 🚨 🚨 🚨 🚨 🚨 ');
      } 
      self.userInfo.user_id = String.fromCharCode.apply(null, data.slice(5, 5 + data[4]));
      self.log('ConnAckMessage', self.userInfo.user_id);
      // 询问过往消息
      self.send(self.genMsg('QueryMessage'));
      break;
    // PublishMessage
    case 3:
      if (data[0] !== 51) return;
      var pos = 6 + data[6] + 2;
      pos = pos + data[pos] + 2 + 1;
      var uint8Data = data.slice(pos);
      var result = Modules['DownStreamMessage'].decode(uint8Data);
      self.log('===================== 📣   PublishMessage =====================');
      self.log(result.msgId, result.fromUserId, result.content.toUTF8());
      // 做出应答 PubAckMessage 应答
      self.send(self.genMsg('PubAckMessage'));
      break;
    // QueryAckMessage
    case 6:
      var uint8Data = data.slice(9);
      var results = Modules['DownStreamMessages'].decode(uint8Data);
      self.log('===================== QueryAckMessage =====================');
      results.list.forEach(function(val){
        self.log(val.content.toUTF8());
      });
      self.log('===================== END =====================');
      // 必须做出应答，不然无法监听 Pub
      self.send(self.genMsg('QueryConMessage'));
      break;
    // PingRespMessage
    case 13:
      self.log('===================== 💓  ' + self.userInfo.id + ' 接收到心跳包 💓 ========================');
      break;
    case 14:
      self.log('===================== 🚒🚒  ' + self.userInfo.id + ' 与服务器断开连接 🚒🚒  ========================');
      // 防止通道关闭后，继续发送导致的报错
      clearInterval(self.heatbeats);
      break;
  }
};

RYWatcher.prototype.log = function(){
  var self = this;
  var args = Array.prototype.slice.apply(arguments);
  console.log.apply(null, ['🐶 [', self.userInfo.id, ']'].concat(args));
};

RYWatcher.prototype.serverNav = function(){
  var self = this;
  var navURL = `http://nav.cn.ronghub.com/navi.js?appId=${self.appId}&token=${encodeURIComponent(self.userInfo.token)}&callBack=getServerEndpoint&t=${Date.now()}`;

  var options = { 
    method: 'GET',
    url: navURL,
    headers: { 
       'cache-control': 'no-cache',
       'content-type': 'application/json' 
    },
    json: false
  };

  return new Promise(function(resolve, reject){
    request(options, function (error, response, body) {
      if(error){
        return reject(error);
      }
      body = JSON.parse(/getServerEndpoint\((.+)\)/g.exec(body)[1]);
      resolve(body);
    });
  });
};

module.exports = RYWatcher;
