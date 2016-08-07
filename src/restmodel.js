
angular.module('datamodel',[]);

angular.module('datamodel').factory('Model', function($http,$q) {

    // Define the Model up here since CommonApi depends on it.
    function Model(config) {
        this.urlPrefix = config.urlPrefix;
        this.appendTrailingSlash = !!config.appendTrailingSlash;
        this.entities = {};
    }

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
                throw "Problems: " + errors;
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
            this.$restAction({
                method: 'POST'
            });
        },

        $put: function() {
            this.$restAction({
                method: 'PUT'
            });
        },

        $delete: function() {
            this.$restAction({
                method: 'DELETE'
            });
        }

    }

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
            for (pk in data) {
                this.push(type.getInstanceByPk(pk));
            }
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

    Collection.prototype.$clear = function() {
        this.length = 0;
    }

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
            return this.url + '/' + this.$pk;
        }
    }

    BaseEntity.prototype.$decodeAndPopulate = function(data) {

        for (key in data) {
            if (this.fields[key]) {
                this[key] = this.fields[key].decode(data[key]);
            } else {
                this[key] = data[key];
            }
        }

        var hasPk = (typeof this.$pk === 'undefined');
    }

    BaseEntity.prototype.$encode = function() {
        var data = {};
        for (key in this) {
            if (! key.startsWith("$")) {
                if (this.fields[key] && this.type.$fields[key].encode) {
                    data[key] = this.fields[key].encode(this[key]);
                } else {
                    data[key] = data[key];
                }
            }
        }
        return data;
    }

    /**
    * Create a new Entity type.
    *
    * @param EntityName name of the entity.
    * @param config     an entity definition object. (see doc)
    * @param resolve    If true, will try to resolve relationTo and
    *                   relationToMany that are configured using strings.
    */
    Model.prototype.createEntityType = function(EntityName,
        config,
        resolveRelations = true) {

            Entity.prototype = new BaseEntity(config);

            function Entity() {

                for (fieldname in this.fields) {
                    var field = this.fields[fieldname];

                    if (field.relationTo) {
                        this[fieldname] = field.relationTo;
                    } else if (field.relationToMany) {
                        this[fieldname] = new Collection(field.relationTo, {
                            url: field.url || fieldname || field.relationTo.url,
                            entityContext: this
                        });
                    }
                }
            }

            Object.defineProperty(Entity.prototype,
                                  config.pkField || 'id',
                                  {
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

            Entity.all = new Collection(Entity, {
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

                var instance = this.instances[pk];
                if (! instance) {
                    instance = new Entity();
                    instance.$pk = pk;
                    this.instances[pk] = instance;
                    console.log('Miss: ' + pk);
                } else {
                    console.log('Hit: ' + pk);
                }
                return instance;
            }

            this.entities[EntityName] = Entity;

            if (resolveRelations) {
                this.resolveRelations();
            }

            return Entity;
        }
        /*
        * Iterate through all the entities and look for fields
        * with relationTo and relationToMany that are not entities,
        * and try to assign an entity to them.
        */
        Model.prototype.resolveRelations = function() {
            var changes;

            do {
                changes = false;

                for (entityname in this.entities) {
                    var entity = this.entities[entityname];

                    for (fieldname in entity.fields) {
                        var relationTo = entity.fields[fieldname].relationTo;
                        if (relationTo &&
                            ! (relationTo instanceof BaseEntity) &&
                            this.entities[relationTo] instanceof BaseEntity) {

                                entity.fields[fieldname].relationTo = this.entities[relationTo];
                                changes = true;

                            }
                            var relationToMany = entity.fields[fieldname].relationToMany;
                            if (relationToMany &&
                                ! (relationToMany instanceof BaseEntity) &&
                                this.entities[relationToMany] instanceof BaseEntity) {

                                    entity.fields[fieldname].relationToMany = this.entities[relationToMany];
                                    changes = true;
                                }
                            }
                        }

                    } while (changes > 0);
                }

                Model.prototype.getFullUrl = function(localUrl){
                    var fullUrl = this.urlPrefix + localUrl;

                    if (this.appendTrailingSlash && !fullUrl.endsWith('/')) {
                        fullUrl += '/';
                    }

                    return fullUrl;
                }

                return Model;

            });
