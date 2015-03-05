/*global module:false require:false process:false __dirname:false*/
/*jshint strict:false unused:true smarttabs:true eqeqeq:true immed: true undef:true*/
/*jshint maxparams:7 maxcomplexity:7 maxlen:150 devel:true newcap:false*/

//Gleaned miscellaneous from:
//https://npmjs.org/package/simplecrawler
//https://github.com/sylvinus/node-crawler
//https://npmjs.org/package/crawl

//Using cheerio:
// https://github.com/cbright/node-crawler

var Crawler = require('./node-crawler').Crawler;
var VOW = require('dougs_vow');
var Url = require('url');
var sm = require('sitemap');
var request = require('request');
var extend = require('extend');
var parseString = require('xml2js').parseString;
var wash = require('url_washer');
var fs = require('fs-extra');
var md5 = require('MD5');
var Path = require('path');
var _ = require('underscore');
// util = require("util");

//Modified crawler.js module, line 384:
// //Static HTML was given, skip request
// if (toQueue.html) {
//     if (typeof toQueue.html==="function") {
//         toQueue.html(toQueue.uri, function(html) {
//             if (html)
//                 self.onContent(null,toQueue,{body:html},false);
//             else self.onContent('No html received',toQueue,null,false);
//         });
//     }
//     else self.onContent(null,toQueue,{body:toQueue.html},false);
//     return;
// }

//TODO update dougs_vow repo with my vow.status edit
//TODO update wash.js in repo


var defaults = { 
  maxDepth: 5,
  maxFollow: 0,
  verbose: false,
  silent: false,
  timeout: 60000,
  retryTimeout: 10000,
  retries: 3,
  ignore: {
    extensions: ['xls', 'png', 'jpg', 'png','js', 'css'],
    uris: []
  },
  include: {
    extensions: ['pdf', 'doc', 'docx']
  },
  cacheDir: './cache',
  sitemap: true,
  html: false,
  out: 'sitemap.xml'
  // replaceHost: 'www.example.com'
};

function getCrawler(options) {
  var followed,
    dynamic,
    host,
    files,
    text;

  debug(options);

  // var log = [];
  function debug() {
    if (options.verbose) console.log.apply(console, arguments);
    // log.push(arguments);
  }

  function filter(url) {
    var parsed = Url.parse(url);

    function ignoreByExtension(url) {
      return options.ignore.extensions.some(function(e) {
        return url.match(new RegExp('\\.' + e + '$', 'i'));
      });
    }

    function ignoreByUri(url) {
      return options.ignore.uris.some(function(e) {
        return url.indexOf(e) !== -1;  
      });
    }

    return parsed.host !== host || ignoreByExtension(url) || ignoreByUri(url);
  }

  function fetchSitemap(url) {
    var vow = VOW.make();

    request(Url.resolve(url, 'sitemap.xml'), function(err, response, body) {
      if (err || response.statusCode !== 200) {
        vow.keep([]);
      } else {
        parseString(body, function(err, result) {
          if (err) {
            debug('No sitemap.xml found at', url);
            vow.keep([]);
          } else {
            debug('sitemap.xml found at', url);
            var urls = [];
            result.urlset.url.forEach(function(l) {
              urls.push(l.loc[0]);
            });
            vow.keep(urls);
          }
        });
      }
    });

    return vow.promise;
  }

  function printDot() {
    if (!options.silent && !options.verbose)
      process.stdout.write('.');
  }

  function extractLinks(result, $) {
    if (result.uri) debug('Parsing ',  result.uri);
    else debug('Parsing washed: ', result.options.uri);
    var links = [];
    // debug(Object.keys(result.body));
    if (result.links) {
      links = result.links;
      links.forEach(function(l) {
        text[l.href] = l.text;
      });
    } else if (result.headers && result.headers['content-type'] === 'text/html' && $) {
      $('a').each(function(index,a) {
        links.push(a.href);
        text[a.href] = $(a).text();
      });
    }
    return links;
  }

  function maxFollowed(vow) {
    var isMax = false;

    if (options.maxFollow && Object.keys(followed).length >= options.maxFollow) {
      if (vow.status() === 'pending') vow.keep();
      isMax = true;
    }
    
    if (isMax) {
      debug('maxFollowed is true')
    }

    return isMax;
  }

  function validUri(uri) {
    return !followed[uri] && !filter(uri, host);
  }

  function getHtml(url, cb) {
    debug('washing ' + url);

    wash(url).when(
      function(result) { //html, headers and links
        fs.outputJsonSync(Path.resolve(__dirname, options.cacheDir, md5(url)), { val: result.html } );
        result.body = result.html;
        cb(result);
      },
      function(err) {
        debug('ERROR washing url:', err);
        cb();
      }
    );
  }

  function harvest(seed) {
    var vow = VOW.make();

    var c = new Crawler({
      maxConnections: options.maxConnections,
      timeout: options.timeout,
      retryTimeout: options.retryTimeout,
      retries: options.retries,
      callback: function(error, result, $) {
        // debug('in callback \n', error ? error : 'no error', result ? result.body.slice(0,20): '');
        if (error) {
          debug('error', error);
        }

        if ($ && $('meta[name="fragment"][content="!"]').length) {
          // debug('Ajax crawler meta tag found');
          fetch('phantom', result.uri, result.options.depth); //fetch again          
          return;
        }

        if (maxFollowed(vow)) {
          return;
        }

        var links = extractLinks(result, $);  
        // debug('Links length', links.length);
        
        links.forEach(function(link) {
          var href = link.href || link,
            url = Url.parse(href),
            ext = Path.extname(url.pathname).slice(1),
            method;

          if (options.include.extensions.indexOf(ext) !== -1 && !files[url.pathname]) {
            files[url.pathname] = true;
            debug('Found included file:', url.pathname);
            method = 'ignore';
          } else {
            method = url.hash && url.hash.indexOf('#!') === 0 ? 'phantom' : 'crawl';
          }
          
          fetch(method, href, result.options.depth + 1);
        });
      },
      onDrain: function() {
        if (vow.status() === 'pending') vow.keep(followed);
      }
    });

    function fetch(method, uri, depth) {
      printDot();

      if (maxFollowed(vow)) {
        return;
      }

      if (validUri(uri) && depth <= options.maxDepth) {
        debug('Following link ' + uri + ' with ' + method);
        followed[uri] = true;
        if (method === 'ignore') {

        } else if (method === 'crawl') {
          c.queue({ uri: uri, depth: depth});
        }
        else {          
          dynamic.push(uri);
          c.queue({ uri: uri, html: getHtml, jQuery: false, depth: depth });
        }
      }        
    }

    fetch('phantom', seed, 0);
    return vow.promise;
  }

  function respond(vow, seed) {
    // debug('followed:', followed);
    var sitemap = {
      hostname: host,
      urls: []
    };

    var html = '';
    
    Object.keys(followed).forEach(function(l) {
      var linkText = text[l] || 'notext';
      if (options.replaceHost) {
        var re = new RegExp(seed, 'g');
        l = l.replace(re, options.replaceHost);
      }
      // custom code
      l = l.replace('?play=true', '');
      sitemap.urls.push( { url: l, changefreq: options.changefreq });
      if (linkText) html += '  <li><a href="' + l  + '">' + linkText + '</a></li>\n';
    });
    html = ['<ul>\n', html, '</ul>'].join('');
    sitemap = sm.createSitemap(sitemap).toString();
    vow.keep({ sitemap: sitemap, html: html, list: Object.keys(followed), phantomed: dynamic });
  }

  function getData(seed) {
    var vow = VOW.make(),
      seeds = [];

    followed = {};
    dynamic = [];
    files = {};
    text = {};
    
    host = Url.parse(seed || '').host;

    if (!host) {
      vow.breek('No seed passed in.');
    } else {
      fetchSitemap(seed).when(
        function(someLinks) {
          if (!options.sitemap) {
            someLinks.forEach(function(l) {
                seeds.push(l);
            });
          }

          if (seed) {
            seeds.push(seed);
          }

          function recur() {
            if (seeds.length) {
              harvest(seeds.pop()).when(
                recur
              );
            } else {
              respond(vow, seed);
            }
          }

          recur();
        }
      );
    }

    return vow.promise;
  }

  function go(seed) {
    var vow = VOW.make();
    getData(seed).when(
      function(data) {
        if (!options.out) {
          vow.keep(data);
          return;
        }
        fs.outputFile(options.out, data.sitemap, function(err) {
          if (err) vow.breek(err);
          else fs.outputFile('sitemap.html', data.html, function(err) {
            if (err) vow.breek(err);
            else vow.keep(data);
          });
        });
      }
    );
    return vow.promise;
  }
  return go;
}


module.exports = function(someOptions) {
  var include = _.extend(defaults.include, someOptions.include),
    ignore = _.extend(defaults.ignore, someOptions.ignore),
    options = _.extend(defaults, someOptions);
  options.include = include;
  options.ignore = ignore;
  return getCrawler(options);
};

// module.exports = 

// // Test
// var c = module.exports({ verbose: true,
//   replaceHost: 'http://www.abc.net.au/radio',
//   sitemap: true,
//   out: 'sitemap.xml'
// });

// c('http://localhost:8888').when(
//   function(data) {        
//     // console.log('SITEMAP:\n', data.sitemap);
//     // console.log('HTML:\n', data.html);
//     console.log('LIST:\n', data.list);
//   }
//   ,function(err) {
//     console.log('ERROR', err);
//   }
// );
