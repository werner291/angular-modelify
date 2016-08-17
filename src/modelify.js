
angular.module('datamodel',[]);

angular.module('datamodel').factory('Model', function($http,$q) {

    /////////////////
    /// CommonApi ///
    /////////////////

    var CommonApi = {

        /**
        * A helper function that executes an $http call.
        *
        * On POST or PUT calls, it automatically includes
        * information about the collection or the instance and,
        * on success, updates the instance or collection with
        * data received from the server.
        *
        * $pending will be set to true for the duration of the action.
        *
        * @param config An almost-normal $http config object that is copied
        *               and passed almost directy to $http. (see below)
        *
        * The config object is the same as the $http config object, with the
        * following exceptions:
        *
        * - config.url will be prefixed with the urlPrefix of the model
        *   and suffixed with a slash if there isn't any and appendTrailingSlash
        *   is enabled on the model. Use config.absoluteUrl to use that url directly.
        *
        *   If absent, a url will be generated from the object this method is called on.
        *
        * @returns promise
        */
        $restAction: function(config) {

            // Take copy to prevent modifying the original object in case
            // someone re-uses configs.
            config = angular.copy(config);

            // Determine the url.
            if (config.absoluteUrl) {
                // If an absolute url is specified, use it onmodified
                config.url = absoluteUrl;
            } else if (config.url) {
                // If a local url is specified, ask the model to make it into
                // a full url (with prefixes and stuff)
                config.url = this.model.getFullUrl(config.url);
            } else {
                // Use this object's own url for the request.
                config.url = this.model.getFullUrl(this.$getUrl());
            }

            // Set method to GET if falsy.
            config.method = config.method || 'GET';

            if (config.method == 'POST' || config.method == 'PUT') {
                // POST and PUT requests require the encoded entity in the body.
                config.data = this.$encode();
            }

            // Store reference to "this"
            var thisResource = this;

            // Set $pending to true so that the interface can react to
            // the object being loaded.
            thisResource.$pending = true;

            // The actual $http call.
            return $http(config).then(function(response) {
                // Request done, set $pending to false.
                thisResource.$pending = false;
                if (response.data) {
                    // Response data is assumed to be an updated version of
                    // the object, decode and patch it.
                    this.$loaded = true;
                    thisResource.$decodeAndPopulate(response.data);
                }
                return thisResource;
            }, function(errors) {
                // Non-success.
                console.error(errors);
            });
        },

        $load: function() {
            return this.$restAction({
                method: 'GET'
            });
        },

        $loadUnlessLoaded: function() {
            if (! this.$loaded) {
                return this.$load();
            } else {
                return $q.when(this);
            }
        },

        $post: function() {
            return this.$restAction({
                method: 'POST'
            });
        },

        $put: function() {
            return this.$restAction({
                method: 'PUT'
            });
        },

        $delete: function() {
            this.$restAction({
                method: 'DELETE'
            });
        }

    }

    /**
     * A Collection is a special type of Array representing a collection
     * of Entity instances. It can also be used to represent a to-many
     * relation
     *
     * @param {[type]} type   [description]
     * @param {[type]} config [description]
     */
    function Collection(type, config) {
        this.type = type;
        this.url = config.url;
        this.$loaded = false;
        this.encodedAsPks = config.$encodedAsPks;
        this.urlContext = config.urlContext;
    }

    Collection.prototype = new Array();

    angular.extend(Collection.prototype, CommonApi);

    Collection.prototype.$getUrl = function() {
        if (this.urlContext) {
            return this.urlContext.$getUrl() + this.url;
        } else {
            return this.url;
        }
    }

    Collection.prototype.$decodeAndPopulate = function(data) {
        if (! data instanceof Array) {
            throw "Expected data to be Array, got " + (typeof data);
        }

        this.$clear();

        if (this.$encodedAsPks) {
            var self = this;
            angular.forEach(data, function(pk) {
                self.push(type.getInstanceByPk(pk));
            });
        } else {
            for (const entData of data) {

                var instance;

                if (typeof entData[this.type.pkField] !== 'undefined') {
                    instance = this.type.getInstanceByPk(entData[this.type.pkField]);
                } else {
                    instance = new this.type();
                }

                instance.$decodeAndPopulate(entData);
                this.push(instance);
            }
        }
    }

    /**
     * Get a JSON-safe representation.
     *
     * If $encodedAsPks is true, an array containing the primary keys
     * of the objects is returned. If it is falsy (default), an array
     * is returned containing the $encode-d instances.
     *
     * @return {array} The JSON-safe encoded collection.
     */
    Collection.prototype.$encode = function () {
        if (! this.$loaded) {
            throw 'Attempting to $encode a Collection that is not loaded.';
        }

        var coll = this;

        var encoded = [];

        angular.forEach(coll, function(instance) {
            encoded.push(this.$encodedAsPks ? instance.$pk : instance.$encode());
        });

        return encoded;
    }

    Collection.prototype.$clear = function() {
        this.length = 0;
    }

    //////////////
    /// Entity ///
    //////////////

    function BaseEntity(config) { }

    angular.extend(BaseEntity.prototype, CommonApi);

    Object.defineProperty(BaseEntity.prototype, "$pk", {
        get: function() { return this.$_pkValue; },
        set: function(newValue) {
            if (this.$_pkValue == newValue) {
                return;
            }

            if (this.$_pkValue && this.instances[$_pkValue]) {
                delete this.instances[$_pkValue];
            }

            if (this.instances[newValue]) {
                throw 'An instance with primary key ' + newValue +
                ' already exists. Primary keys must be unique.';
                this.instances[newValue] = this;
            }
            this.$_pkValue = newValue;
        }
    });

    BaseEntity.prototype.$getUrl = function() {
        if (this.urlContext) {
            return this.urlContext.$getUrl() + this.url + '/' + this.$pk;
        } else {
            return this.url + '/' + this.$pk + '/';
        }
    }

    /**
     * Essentially the inverse of $encode.
     *
     * The data is taken from the data parameter, decoded, and patched into
     * this object, overwriting any existing properties.
     *
     * To get a new object, simply call EntityName.getInstanceByPk, and then call $decode
     * on it. If there is no private key, call new EntityName.
     *
     * $decode also updates the object cache.
     *
     * @param  {[type]} data [description]
     * @return {[type]}      [description]
     */
    BaseEntity.prototype.$decodeAndPopulate = function(data) {

        var self = this;
        angular.forEach(data, function(value,key) {
            if (self.fields[key] && self.fields[key].decode) {
                self[key] = self.fields[key].decode(data[key]);
            } else if (this[key] && self[key].$decodeAndPopulate) {
                self[key].$decodeAndPopulate(data[key]);
            } else {
                self[key] = data[key];
            }
        });

        var hasPk = (typeof this.$pk === 'undefined');
    }

    /**
     * Get a $http-friedly object from te instance.
     * The result of $encode is directly passed to $http(config) as config.data.
     *
     * @return {[type]} [description]
     */
    BaseEntity.prototype.$encode = function() {
        var data = {};
        var self = this;
        angular.forEach(this, function(value,key) {
            if (! key.startsWith("$") &&
                ! (value.$loaded === false)) {
                if (self.fields[key] && self.fields[key].encode) {
                    data[key] = self.fields[key].encode(self[key]);
                } else if (value.$encode){
                    data[key] = value.$encode();
                } else {
                    data[key] = value;
                }
            }
        });
        return data;
    }

    BaseEntity.prototype.$save = function() {
        if (this.$pk) {
            return this.$put();
        } else {
            return this.$post();
        }
    }

    /////////////
    /// Model ///
    /////////////

    // Define the Model up here since CommonApi depends on it.
    function Model(config) {
        this.urlPrefix = config.urlPrefix;
        this.appendTrailingSlash = !!config.appendTrailingSlash;
        this.entities = {};
        this.fields = config.fields || {};
        this.unresolvedRelations = {};
    }

    /**
    * Create a new Entity type.
    *
    * @param EntityName name of the entity.
    * @param config     an entity definition object. (see doc)
    * @param resolve    If true, will try to resolve relationTo and
    *                   relationToMany that are configured using strings.
    */
    Model.prototype.createEntityType = function(EntityName, config) {

        var model = this;

        Entity.prototype = new BaseEntity(config);

        function Entity() {

            for (fieldname in this.fields) {
                var field = this.fields[fieldname];

                if (field.relationTo || field.relationToMany) {

                    var specified = (field.relationTo || field.relationToMany);

                    var resolved = (specified instanceof BaseEntity) ?
                    specified : model.entities[specified];

                    if (resolved) {
                        if (field.relationTo) {
                            this[fieldname] = resolved;
                        } else {
                            this[fieldname] = model.createCollection(resolved, {
                                url: field.url || fieldname || field.relationToMany.url,
                                urlContext: this
                            });
                        }
                    } else {
                        model.registerUnresolvedRelation(field, this, fieldname);
                    }
                }

            }

            if (config.instance) {
                angular.extend(this, config.instance);
            }
        }

        Object.defineProperty(Entity.prototype, config.pkField || 'id', {
            get: function() {
                return this.$pk;
            },
            set: function(newVal) {
                this.$pk = newVal;
            }
        });

        Entity.pkField = config.pkField || 'id';

        angular.extend(Entity.prototype, config.instance);

        angular.extend(Entity, config.static);

        Entity.constructor = Entity;

        Entity.model = this;

        Entity.all = model.createCollection(Entity, {
            url: config.url
        });

        Entity.all.model = this;

        Entity.instances = {};
        Entity.url = config.url || '';
        Entity.fields = config.fields || {};

        Entity.get = function(pk) {
            return this.getInstanceByPk(pk).$loadUnlessLoaded();
        }

        // Make the properties of Entity available on instances.
        // This is similar to how static class members are available
        // to all instances in languages like Java or C++
        angular.extend(Entity.prototype, Entity);

        /**
        * Fetch an instance with this primary key.
        * An empty instance is returned is none is in the cache,
        * if one it, that one is returned.
        *
        * Call $loadUnlessLoaded on the returned instance to ensure
        * that it is loaded.
        */
        Entity.getInstanceByPk = function(pk) {
            // Check in the instances if there is one with that pk
            var instance = this.instances[pk];
            if (! instance) {
                // It doesn't exist, create one and assign it a the pk
                instance = new Entity();
                instance.$pk = pk; // Adds it automatically to instances
            }
            return instance;
        }

        // Store it as part of the model
        model.entities[EntityName] = Entity;

        // Check if there were unresolved relations on previous entries that refer to this entity.
        if (model.unresolvedRelations[EntityName]) {
            // Iterate over all entries
            for (entry of model.unresolvedRelations[EntityName]){
                if (entry.field.relationTo) { // Was it a to-one relation?
                    entry.on[entry.fieldName] = Entity;
                } else { // Or a to-many relation?
                    entry.on[entry.fieldName] = model.createCollection(Entity, {
                        url: entry.field.url || entry.fieldName || entry.field.url,
                        urlContext: this
                    });
                }
            }
            // Resolved!
            delete unresolvedRelations[EntityName];
        }
    }

    Model.prototype.registerUnresolvedRelation = function(field, on, fieldName) {
        var entName = field.relationTo || field.relationToMany;
        if (!this.unresolvedRelations[entName]) {
            this.unresolvedRelations[entName] = [];
        }
        this.unresolvedRelations[entName].push({
            field: field,
            on: this,
            fieldName: fieldname
        });
    }

    Model.prototype.createCollection = function(entity, config) {
        var collection = new Collection(entity, config);
        collection.model = this;
        return collection;
    }

    Model.prototype.exposeEntity = function(entName) {
        var ent = this.entities[entName];
        if (!ent) {
            throw "Unknown entity with name " + entName;
        }
        return ent;
    }

    /**
    * Translate a local url into an absolute url.
    *
    * For example, transform '/houses/1'
    * into 'http://api.example.com/houses/1/'
    *
    * @param  {string} localUrl The local url
    * @return {string}          The resulting full url.
    */
    Model.prototype.getFullUrl = function(localUrl){
        var fullUrl = this.urlPrefix + localUrl;

        if (this.appendTrailingSlash && !fullUrl.endsWith('/')) {
            fullUrl += '/';
        }

        return fullUrl;
    }

    return Model;

});
