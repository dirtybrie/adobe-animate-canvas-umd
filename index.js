require('./src/createjs-shim');

/**
 * CanvasUmd object that manages export conversion
 * @param options UMD conversion options
 * @param options.module-name UMD module name. Should match the input filename
 * @param [options.parse-labels] EXPERIMENTAL. Interpret frame labels for reading prior to canvas initialization
 * @returns {CanvasUmd}
 * @constructor
 */
function CanvasUmd(options) {
  if(!(this instanceof CanvasUmd))
    return new CanvasUmd(options);

  var nameWarningRx = /^\d|\W/g;

  if(!('module-name' in options)) {
    throw new Error("Missing required argument 'module-name'");
  }
  /*
   * If an Adobe Animate file name contains any weird characters, the JS export won't quite match
   * because of variable naming limitations. CanvasUmd will attempt to correctly filter the name but the rules
   * Adobe uses are not documented anywhere.
   *
   * Noted observations:
   * 1) Capitalization IS preserved
   * 2) Instances that start with a numeral are prefixed by `_`
   * 3) Special characters ($, parenthesis) and whitespace are filtered out
   */
  else if(nameWarningRx.test(options['module-name'])) {
    var name = options['module-name']
        // Prefix underscore when first character is a number
        .replace(/^(\d)/, "_$1")
        // Remove non-word characters (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#special-non-word)
        .replace(/\W/g, "");

    console.warn(
        'Special characters detected!\n' +
        'You are probably seeing this message because the Adobe Animate source file contained whitespace or special characters.\n' +
        'CanvasUmd will attempt to remap the filename, but it is safer to use only letters, numbers, and underscores in the name of your FLA/XFL file.\n' +
        'Inferred name: ' + name
    );

    options['module-name'] = name;
  }



  this.options = options;

  // UMD template
  this.template = "(function (root, factory) {\n" +
  "\tif (typeof define === 'function' && define.amd) {\n" +
  "\t\t// AMD. Register as an anonymous module.\n" +
  "\t\tdefine(['exports'], factory);\n" +
  "\t} else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {\n" +
  "\t\t// CommonJS\n" +
  "\t\tfactory(exports);\n" +
  "\t} else {\n" +
  "\t\t// Browser globals\n" +
  "\t\tfactory((root.commonJsStrict = {}));\n" +
  "\t}\n" +
  "}(this, function (exports) {\n" +
  "\t{{REPLACE}}\n" +
  "}));";
}

CanvasUmd.prototype = {
  /**
   * Deletes createjs declaration from last line of canvas export because CreateJS breaks if it's not globally accessed
   * @param {string} exportJS The default Adobe Animate CC 2017 JavaScript global module, e.g. (function(lib, img, cjs, ss, an){...})
   * @returns {string}
   */
  removeCreateJSVar: function removeCreateJSVar(exportJS) {
    var lines = exportJS.toString().split('\n');
    var noGoodVeryBadGlobals = lines.pop().replace(/createjs,?\s?/, '');
    lines.push('//// var "createjs" filtered out by canvas-umd to allow encapsulated interop', noGoodVeryBadGlobals);
    return lines.join('\n');
  },

  /**
   * Splits last line of canvas export variables in to an array of variable names
   * This is needed to infer the 'lib' namespace by argument position, since it's possible an author might change said namespace in Animate
   * @param {string} exportJS The default Adobe Animate CC 2017 JavaScript global module, e.g. (function(lib, img, cjs, ss, an){...})
   * @returns {Array}
   */
  getExportedVars: function getExportedVars(exportJS) {
    var lines = exportJS.split('\n');
    var varList = lines.pop().replace(/(var\s|[,;])/g, '').split(/\s/);
    return varList;
  },

  /**
   * Frame labels aren't a static property of the default export, meaning we can't evaluate against them. This method
   * actually constructs the canvas instance in order to write them out in the UMD for evaluation.
   * @param {string} exportJS The default Adobe Animate CC 2017 JavaScript global module, e.g. (function(lib, img, cjs, ss, an){...})
   * @returns {Array<Object>|undefined}
   */
  getFrameLabels: function(exportJS) {
    var exportedVars = this.getExportedVars(exportJS);
    var AdobeAn = exportedVars[0];
    var initializer = 'return new (' + AdobeAn + '.compositions[Object.keys(' + AdobeAn + '.compositions)[0]].getLibrary()["'+ this.options['module-name'] +'"])();';
    var wrap = 'return (function(){' + exportJS + '\n\n' + initializer + '\n})()';
    var def = new Function(wrap)();

    if(def.timeline) {
      return def.timeline.getLabels();
    }
  },

  /**
   * Wraps global js export to universal module definition and appends additional data
   * @param {string} exportJS The default Adobe Animate CC 2017 JavaScript global module, e.g. (function(lib, img, cjs, ss, an){...})
   * @returns {string}
   */
  Animate2UMD: function Animate2UMD(exportJS) {
    var exportVars = this.getExportedVars(exportJS);
    var replaceToken = '{{REPLACE}}';

    var frameLabels = (this.options['parse-labels'])? this.getFrameLabels(exportJS): {};
    var frameExport = '\t//// frameLabels generated by canvas-umd for static evaluation\n' +
      '\t'+ exportVars[0] + '.properties["frameLabels"] = ' + JSON.stringify(frameLabels) + ';\n';

    var moduleExport = '\t//// Animate export wrapped by canvas-umd\n'+
        exportVars.reduce(function(acc, val) { return acc + '\texports["' + val + '"] = ' + val + ';\n'; }, '') +
        '\texports["default"] = exports["construct"] = ' + exportVars[0] + '["'+this.options['module-name']+'"];\n';

    // Done massaging data points, now put all the pieces together
    var wrappedModule = exportJS + '\n\n' + frameExport + '\n\n' + moduleExport;
    return this.template.replace(replaceToken, wrappedModule)  + '\n';
  },

  /**
   * Animate CC 2017.5
   * @param exportJS The default Adobe Animate CC 2017.5 JavaScript global module, e.g. (function(cjs, an){...})
   * @returns {string}
   */
  Animate2UMD2017_5: function Animate2UMD(exportJS) {
    var exportVars = this.getExportedVars(exportJS);
    var replaceToken = '{{REPLACE}}';
    var AdobeAn = exportVars[0];

    var frameLabels = (this.options['parse-labels'])? this.getFrameLabels(exportJS): {};
    console.log(frameLabels);

    var moduleExport =  '\t//// Animate CC 2017.5 export wrapped by canvas-umd\n'+
        '\tvar compId = Object.keys(' + AdobeAn + '.compositions)[0];\n' +
        '\tvar comp = ' + AdobeAn + '.compositions[compId];\n' +
        '\tcomp.getLibrary().properties.frameLabels = ' + JSON.stringify(frameLabels) +';\n\n' +
        '\texports["default"] = ' + AdobeAn + '.compositions[compId];\n' +
        '\texports["construct"] = exports["default"].getLibrary()["' + this.options['module-name'] + '"];\n';

    // Done massaging data points, now put all the pieces together
    var wrappedModule = [exportJS, moduleExport].join('\n\n');
    var template = this.template.replace(replaceToken, wrappedModule);

    return template;
  },

  /**
   * Converts raw Adobe Animate JS export to universal module definition for modern JavaScript ecosystem usage
   * @param exportJS
   * @returns {string}
   */
  convert: function(exportJS) {
    var sanitized = this.removeCreateJSVar(exportJS);
    var umd = this.Animate2UMD2017_5(sanitized);
    return umd;
  }
};

CanvasUmd.default = CanvasUmd;
module.exports = CanvasUmd;