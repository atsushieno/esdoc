import fs from 'fs';
import path from 'path';
import {markdown} from './util.js';

export default class DocResolver {
  constructor(builder) {
    this._builder = builder;
    this._data = builder._data;
  }

  resolve() {
    this._resolveAccess();
    this._resolveOnlyExported();
    this._resolveIgnore();
    this._resolveMarkdown();
    this._resolveLink();
    this._resolveExtendsChain();
  }

  _resolveIgnore() {
    if (this._data.__RESOLVED_IGNORE__) return;

    let docs = this._builder._find({ignore: true});
    for (let doc of docs) {
      var regex = new RegExp(`^${doc.longname}[.~#]`);
      this._data({longname: {regex: regex}}).remove();
    }
    this._data({ignore: true}).remove();

    this._data.__RESOLVED_IGNORE__ = true;
  }

  _resolveAccess() {
    if (this._data.__RESOLVED_ACCESS__) return;

    let config = this._builder._config;
    let access = config.access || ['public', 'protected', 'private'];

    this._data().update(function(){
      if (!this.access) this.access = 'public';
      if (!access.includes(this.access)) this.ignore = true;
      return this;
    });

    this._data.__RESOLVED_ACCESS__ = true;
  }

  _resolveOnlyExported() {
    if (this._data.__RESOLVED_ONLY_EXPORTED__) return;

    let config = this._builder._config;
    let onlyExported = config.onlyExported;
    if (onlyExported) {
      this._data({export: false}).update({ignore: true});
    }

    this._data.__RESOLVED_ONLY_EXPORTED__ = true;
  }

  _resolveMarkdown() {
    if (this._data.__RESOLVED_MARKDOWN__) return;

    function convert(obj) {
      for (let key of Object.keys(obj)) {
        let value = obj[key];
        if (key === 'description' && typeof value === 'string') {
          obj[key] = markdown(value, true);
        } else if (typeof value === 'object' && value) {
          convert(value);
        }
      }
    }

    let docs = this._builder._find();
    for (let doc of docs) {
      convert(doc);
    }

    this._data.__RESOLVED_MARKDOWN__ = true;
  }

  _resolveLink() {
    if(this._data.__RESOLVED_LINK__) return;

    let link = (str)=>{
      if (!str) return str;

      return str.replace(/\{@link ([\w\#_\-.:\~\/]+)}/g, (str, longname)=>{
        return this._builder._buildDocLinkHTML(longname, longname);
      });
    };

    this._data().each((v)=>{
      v.description = link(v.description);

      if (v.params) {
        for (let param of v.params) {
          param.description = link(param.description);
        }
      }

      if (v.return) {
        v.return.description = link(v.return.description);
      }

      if (v.throws) {
        for (let _throw of v.throws) {
          _throw.description = link(_throw.description);
        }
      }

      if (v.see) {
        for (let i = 0; i < v.see.length; i++) {
          if (v.see[i].indexOf('{@link') === 0) {
            v.see[i] = link(v.see[i]);
          } else if(v.see[i].indexOf('<a href') === 0) {
            // ignore
          } else {
            v.see[i] = `<a href="${v.see[i]}">${v.see[i]}</a>`;
          }
        }
      }
    });

    this._data.__RESOLVED_LINK__ = true;
  }

  _resolveExtendsChain() {
    if (this._data.__RESOLVED_EXTENDS_CHAIN__) return;

    let extendsChain = (doc) => {
      if (!doc.extends) return;

      let selfDoc = doc;

      // traverse super class.
      let chains = [];
      while (1) {
        if (!doc.extends) break;

        let superClassDoc = this._builder._findByName(doc.extends[0])[0];
        if (superClassDoc) {
          chains.push(superClassDoc.longname);
          doc = superClassDoc;
        } else {
          chains.push(doc.extends[0]);
          break;
        }
      }

      if (chains.length) {
        // direct subclass
        let superClassDoc = this._builder._findByName(chains[0])[0];
        if (superClassDoc) {
          if (!superClassDoc._custom_direct_subclasses) superClassDoc._custom_direct_subclasses = [];
          superClassDoc._custom_direct_subclasses.push(selfDoc.longname);
        }

        // indirect subclass
        for (let superClassLongname of chains.slice(1)) {
          superClassDoc = this._builder._findByName(superClassLongname)[0];
          if (superClassDoc) {
            if (!superClassDoc._custom_indirect_subclasses) superClassDoc._custom_indirect_subclasses = [];
            superClassDoc._custom_indirect_subclasses.push(selfDoc.longname);
          }
        }

        // indirect implements and mixes
        for (let superClassLongname of chains) {
          superClassDoc = this._builder._findByName(superClassLongname)[0];
          if (!superClassDoc) continue;

          // indirect implements
          if (superClassDoc.implements) {
            if (!selfDoc._custom_indirect_implements) selfDoc._custom_indirect_implements = [];
            selfDoc._custom_indirect_implements.push(...superClassDoc.implements);
          }

          // indirect mixes
          //if (superClassDoc.mixes) {
          //  if (!selfDoc._custom_indirect_mixes) selfDoc._custom_indirect_mixes = [];
          //  selfDoc._custom_indirect_mixes.push(...superClassDoc.mixes);
          //}
        }

        // extends chains
        selfDoc._custom_extends_chains = chains.reverse();
      }
    };

    let implemented = (doc) =>{
      let selfDoc = doc;

      // direct implemented (like direct subclass)
      for (let superClassLongname of selfDoc.implements || []) {
        let superClassDoc = this._builder._findByName(superClassLongname)[0];
        if (!superClassDoc) continue;
        if(!superClassDoc._custom_direct_implemented) superClassDoc._custom_direct_implemented = [];
        superClassDoc._custom_direct_implemented.push(selfDoc.longname);
      }

      // indirect implemented (like indirect subclass)
      for (let superClassLongname of selfDoc._custom_indirect_implements || []) {
        let superClassDoc = this._builder._findByName(superClassLongname)[0];
        if (!superClassDoc) continue;
        if(!superClassDoc._custom_indirect_implemented) superClassDoc._custom_indirect_implemented = [];
        superClassDoc._custom_indirect_implemented.push(selfDoc.longname);
      }
    };

    //var mixed = (doc) =>{
    //  var selfDoc = doc;
    //
    //  // direct mixed (like direct subclass)
    //  for (var superClassLongname of selfDoc.mixes || []) {
    //    var superClassDoc = this._builder._find({longname: superClassLongname})[0];
    //    if (!superClassDoc) continue;
    //    if(!superClassDoc._custom_direct_mixed) superClassDoc._custom_direct_mixed = [];
    //    superClassDoc._custom_direct_mixed.push(selfDoc.longname);
    //  }
    //
    //  // indirect mixed (like indirect subclass)
    //  for (var superClassLongname of selfDoc._custom_indirect_mixes || []) {
    //    var superClassDoc = this._builder._find({longname: superClassLongname})[0];
    //    if (!superClassDoc) continue;
    //    if(!superClassDoc._custom_indirect_mixed) superClassDoc._custom_indirect_mixed = [];
    //    superClassDoc._custom_indirect_mixed.push(selfDoc.longname);
    //  }
    //};

    let docs = this._builder._find({kind: 'class'});
    for (let doc of docs) {
      extendsChain(doc);
      implemented(doc);
      //mixed(doc);
    }

    this._data.__RESOLVED_EXTENDS_CHAIN__ = true;
  }
}