var config = require('./config.json');
var mkdirp = require('mkdirp')

var pathPhotos = config.pathPhotos;
var previewWidth = config.previewWidth;
var previewHeight = config.previewHeight;
var cardPath = config.cardPath;
var pathPreviews = './public/previews';

var itvPing = null;
var cardFound = false;
var alreadySearching = false;
var alreadyDownloading = false;
var downloadPrevious = true;
var downloadList = new Array();

var os = require('os');
var ip = require('ip');
var http = require('http');
var path = require('path');
var net = require('net');
var dgram = require('dgram');
var fs = require('fs');
var gm = require('gm');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var exec = require('child_process').exec

var express = require('express');
var app = express();
var server = http.createServer(app);

var io = require('socket.io')(server);

var routes = require('./routes/index');
var latestPhoto = require('./routes/latest');
var allPhotos = require('./routes/all');

var cardAddr = ip.subnet(ip.address(), '255.255.255.0').broadcastAddress;

if (typeof config.broadcastAddr !== undefined) {
  cardAddr = config.broadcastAddr;
}

mkdirp(config.pathTempPhotos)

process.title = 'WiPho';
var gracefulShutdown = function() {
  console.log("Shutting down...");
  process.exit();
}

process.on ('SIGTERM', gracefulShutdown);
process.on ('SIGINT', gracefulShutdown);

app.set('port', config.httpPort || 3000);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(__dirname + '/public/favicon.ico'));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/latest', latestPhoto);
app.use('/all', allPhotos);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;

io.on('connection', function (socket) {
  //console.log('Display connected!');
  socket.on('disconnect', function(){
    //console.log('Display disconnected');
  });
  socket.on('display', function(data) {
    if(data.status == 'success') {
      console.log('Photo displayed!');
    } else {
      console.log('Photo not displayed!');
    }
  });
});

server.listen(app.get('port'), function() {
  console.log("WiPho is listening on port " + app.get('port'));
});


/* WiPho */

photos = new Array();
photoIndex = 0;

console.log("#########################################");
console.log("# Make sure you shoot JPEG or RAW+JPEG! #");
console.log("#########################################");

findCard();

function downloadPhotos() {

  if(alreadyDownloading == true || downloadList.length < 1)
    return true;
    
  alreadyDownloading = true;
  var photo = downloadList.pop();
  //var localFile = pathPhotos+'/'+photo;
  var localTempFile = config.pathTempPhotos + '/' + photo;
  var localPreview = pathPreviews+'/'+photo;
  console.log('['+photo+'] Downloading from http://'+cardAddr+cardPath+'/'+photo);
  
  var file = fs.createWriteStream(localTempFile);
    
  file.on('error', function(err) {
    console.log("FS: "+err);
  });
  
  file.on('finish', function() {
    file.close();
    var localFile = pathPhotos+'/'+photo;
    alreadyDownloading = false;
    exec('mv ' + localTempFile + ' ' + localFile, function (err) {
      if (err) {
        console.log(err)
      } else {
        console.log('['+photo+'] Saved as '+localFile);
        
        /*
        gm(localFile).autoOrient().resize(previewWidth, previewHeight).write(localPreview, function (err) {
          if (!err) {
            console.log('['+photo+'] Resized to '+previewWidth+'x'+previewHeight);            
            if(photos.length == 0 || photo != photos[photos.length-1].name) {
              photos.push({id: photoIndex, name: photo});
              photoIndex++;
              io.emit('photo', { path: photo });
            }
          
          }else{
            console.log('Photo resize error: '+err);
          }
          
        });
        */

        if(downloadPrevious == true) {
          getPhotoList();
        }
        
        if(downloadList.length > 0) {
          downloadPhotos();
        }else{
          console.log("All photos downloaded, waiting for new ones...");
        }
      }
    })
    
  });
  
  var options = {
    hostname: cardAddr,
    port: 80,
    path: cardPath+'/'+photo,
    method: 'GET'
  };
  
  var request = http.get(options, function(response) {
    response.pipe(file);
  });
  
  request.on('error', function(e) {
    console.log("HTTP Error: " + e.message);
  });

}

function getPhotoList() {

  downloadPrevious = false;

  var options = {
    host: cardAddr,
    port: 80,
    path: '/cgi-bin/tslist?PATH=/www'+cardPath+'&keepfresh='+Date.now().toString()
  };
  console.log("Requesting list of photos on card...");

  http.get(options, function(resp){
    console.log("Getting list of photos on card...");
    rawData = ''
    resp.on('data', function(chunk){
      rawData += chunk;
    });
    resp.on('end', function(){
      //var strFiles = data.toString().split(os.EOL)[2];
      var strFiles = rawData.toString()
      console.log('strFiles: ' + strFiles)
      var regex = /FileName\d+=([a-zA-Z0-9_\.]+)&FileType\d+=File&/g;
      var arrPhotos = new Array();
      while (match = regex.exec(strFiles)) {
        arrPhotos.push(match[1]);
      }
      var i = 0;
      arrPhotos.forEach(function(photo) {
        fs.exists(pathPhotos+'/'+photo, function(exists) {
          if (exists) {
            console.log('['+photo+'] Photo '+photo+' already downloaded!');
          }else{
            console.log('['+photo+'] Photo '+photo+' not downloaded yet, adding to download list!');
            downloadList.push(photo);
          }
          i++;
          if(i == arrPhotos.length-1) {
            if(downloadList.length > 0) {
              downloadPhotos();
            }else{
              console.log("All photos already downloaded!");
            }
          }
        });
      });
    });
  }).on("error", function(e){
    console.log("Error getting photo list: " + e.message);
    getPhotoList();
  });

}


function enableShootAndView(ip) {

  var client = net.connect({port: 5566, host: ip}, function() {
    console.log('Enabling Shoot & View...');
  });
  
  client.on('connect', function() {
    console.log('Shoot & View enabled, waiting for photos...');
    if(cardPath != null) {
      getPhotoList();
    }
  });
  
  client.on('error', function(err) {
    console.log('Shoot & View error: '+err);
    findCard();
  });
  
  client.on('data', function(data) {
    var path = data.toString().substr(5).replace(/\0/g, '');
    var photo = path.split('/').pop();
    cardPath = path.substring(0, path.lastIndexOf('/'));
    // console.log('cardPath: ' + cardPath)
    downloadList.push(photo);
    downloadPhotos();
  });

  client.on('end', function() {
    console.log('Shoot & View stopped!');
  });

}


function pingCard(ip) {

  req = http.get('http://'+ip+'/', function(res) {
    //console.log('Card is alive!');
    req.destroy();
  });
  
  req.on('error', function(err) {
    cardFound = false;
    console.log('ERROR: ' + err);
    req.destroy();
    clearInterval(itvPing);
    findCard();
  });
  
  req.setTimeout(5000, function() {
    cardFound = false;
    downloadPrevious = true;
    console.log('Card has disappeared!');
    req.destroy();
    clearInterval(itvPing);
    findCard();
  });
  
}


function findCard() {

  if(alreadySearching == true)
    return;
  else
    alreadySearching = true;
    
  console.log("Searching for card...");

  var socket = dgram.createSocket('udp4');
  var message = new Buffer('dummy');
  var itvSearch;
  
  socket.bind(58255, function() {
    socket.setBroadcast(true);
  });
  
  socket.on('error', function (err) {
    console.log("socket error:\n" + err.stack);
    socket.close();
    findCard();
  });

  socket.on('message', function (msg, rinfo) {
    clearInterval(itvSearch);
    socket.close();
    msg = msg.toString();
    cardAddr = msg.match(/ip=(.*)/)[1];
    cardFound = true;
    console.log("Found card on "+cardAddr);
    enableShootAndView(cardAddr);
    itvPing = setInterval(function() {
      pingCard(cardAddr);
    }, 5000);
    alreadySearching = false;
  });

  socket.on('listening', function () {
    var address = socket.address();
    sendSearch();
    itvSearch = setInterval(function() {
      sendSearch();
    }, 2000);
    
    function sendSearch() {
      socket.send(message, 0, message.length, 55777, cardAddr, function(err, bytes) {
        if(err != null)
          console.log("socket error:\n" + err.stack);
      });
    }
    
  });
  
}
