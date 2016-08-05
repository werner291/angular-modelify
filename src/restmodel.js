
angular.module('datamodel',[]);

angular.module('datamodel').factory('Model', function($http) {

    function Collection(type, url, config) {
        this.instances = [];
        this.$type = type;
        this.$url = url;
        this.$loaded = false;
        this.$encodedAsPks = config.$encodedAsPks || false;
    }

    Collection.prototype.$load = function() {
        return $http.get(url).then(function(response) {
            $loaded = true;
            this.$decode(response.data);
        });
    }

    Collection.prototype.$loadUnlessLoaded = function() {
        if (! $loaded) {
            return this.$load();
        } else {
            return this;
        }
    }

    Collection.prototype.$decode = function(data) {
        if (! data instanceof Array) {
            throw "Expected data to be Array, got " + (typeof data);
        }

        this.$clear();

        if (this.$encodedAsPks) {
            for (pk in data) {
                this.instances.push(type.$getInstance(pk));
            }
        } else {
            for (entData in data) {
                this.instances.push(type.$decodeInstance(entData));
            }
        }

    }

    Collection.prototype.$clear = function() {
        this.instances = [];
    }

    function EntityType(url, config) {
        this.instances = [];
        this.url = url;

        this.all = new Collection()
    }

    function Model(config) {
        this.entitytypes = [];
        this.config = config;
    }

    Model.prototype.createEntityType = function(url, config) {
        ent = new Entity(this.baseUrl + url, config);
        this.entitytypes.push(ent);
        return ent;
    }

    return Model;

});
