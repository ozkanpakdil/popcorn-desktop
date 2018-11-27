(function (App) {
    'use strict';

    var getDataFromProvider = function (providers, collection) {
        var deferred = Q.defer();

        var torrentsPromise = torrentProvider.fetch(self.filter);
        var idsPromise = torrentsPromise.then(_.bind(torrentProvider.extractIds, torrentProvider));
        var torResults;

        var promises = [
            torrentsPromise,
            subtitle ? idsPromise.then(_.bind(subtitle.fetch, subtitle)) : true,
            metadata ? idsPromise.then(function (ids) {
                return Q.allSettled(_.map(ids, function (id) {
                    return metadata.movies.summary(id);
                }));
            }) : true
        ];

        win.debug('pre all', promises);

        Q.all(promises)
            .spread(function (torrents, subtitles, metadatas) {
                console.log('post all', torrents, subtitles, metadatas);
                torResults = torrents.results;

                var willWaitFor = 0;

                Q.allSettled(_.map(torrents.results, function (id) {
                    if (Settings.watchedCovers === 'hide' && id.tvdb_id) {
                        return Database.getEpisodesWatched(id.tvdb_id).then(function (watchedEpisodes) {
                            if (watchedEpisodes.length > 0) {
                                willWaitFor++;
                                win.debug('waiting for:'+willWaitFor);
                                return App.Providers.get('TVApi?&apiURL=https://tv-v2.api-fetch.website/,cloudflare+https://tv-v2.api-fetch.website').detail(watchedEpisodes[0].imdb_id, watchedEpisodes[0].imdb_id)
                                    .then(function (show) {
                                        willWaitFor--;
                                        win.debug(show.title + ' ' + show.episodes.length + ' ' + watchedEpisodes.length + ' waiting for:' + willWaitFor);
                                        if (show.episodes.length <= watchedEpisodes.length) {
                                            self.watchedShows.push(show);
                                        }
                                    });
                            }
                        });
                    }
                })).then(function (results) {
                    App.notWanted.forEach(function (doc) {
                        for (var i = torResults.length - 1; i >= 0; --i) {
                            if (torResults[i].imdb_id === doc) {
                                torResults.splice(i, 1);
                            }
                        }
                    });

                    self.watchedShows.forEach(function (doc) {
                        for (var i = torResults.length - 1; i >= 0; --i) {
                            if (torResults[i].imdb_id === doc.imdb_id) {
                                win.debug('deleted' + torResults[i].title);
                                torResults.splice(i, 1);
                            }
                        }
                    });
                    // If a new request was started...
                    metadatas = _.map(metadatas, function (m) {
                        if (!m || !m.value || !m.value.ids) {
                            return {};
                        }

                        m = m.value;
                        m.id = m.ids.imdb;
                        return m;
                    });

                    _.each(torResults, function (movie) {
                        var id = movie[self.popid];
                        /* XXX(xaiki): check if we already have this
                         * torrent if we do merge our torrents with the
                         * ones we already have and update.
                         */
                        var model = self.get(id);
                        if (model) {
                            var ts = model.get('torrents');
                            _.extend(ts, movie.torrents);
                            model.set('torrents', ts);

                            return;
                        }
                        movie.provider = torrentProvider.name;

                        if (subtitles) {
                            movie.subtitle = subtitles[id];
                        }

                        if (metadatas) {
                            var info = _.findWhere(metadatas, {
                                id: id
                            });


                        }
                    });

                    return deferred.resolve(torrents);
                });
            }).catch(function (err) {
                self.state = 'error';
                self.trigger('loaded', self, self.state);
                win.error('PopCollection.fetch() : torrentPromises mapping', err);
        var filters = Object.assign(collection.filter, {page: providers.torrent.page});
        providers.torrent.fetch(filters)
            .then(function (torrents) {
                // If a new request was started...
                _.each(torrents.results, function (movie) {
                    var id = movie[collection.popid];
                    /* XXX(xaiki): check if we already have this
                     * torrent if we do merge our torrents with the
                     * ones we already have and update.
                     */
                    var model = collection.get(id);
                    if (model) {
                        var ts = model.get('torrents');
                        _.extend(ts, movie.torrents);
                        model.set('torrents', ts);

                        return;
                    }

                    movie.providers = providers;
                });

                return deferred.resolve(torrents);
            })
            .catch(function (err) {
                collection.state = 'error';
                collection.trigger('loaded', collection, collection.state);
                console.error('PopCollection.fetch() : torrentPromises mapping', err);
            });

        return deferred.promise;
    };

    var PopCollection = Backbone.Collection.extend({
        popid: 'imdb_id',
        initialize: function (models, options) {
            this.providers = this.getProviders();
            this.watchedShows = [];

            //XXX(xaiki): this is a bit of hack
            this.providers.torrents.forEach(t => {
                t.hasMore = true;
                t.page = 1;
            });

            options = options || {};
            options.filter = options.filter || new App.Model.Filter();

            this.filter = _.clone(options.filter.attributes);
            this.hasMore = true;

            Backbone.Collection.prototype.initialize.apply(this, arguments);
        },

        fetch: function () {
            try {
                var self = this;

                if (this.state === 'loading' && !this.hasMore) {
                    return;
                }

                this.state = 'loading';
                self.trigger('loading', self);

                var subtitle; //TODO: var subtitle = App.Providers.get('ysubs');
                var metadata = this.providers.metadata;
                var torrents = this.providers.torrents;

                /* XXX(xaiki): provider hack
                 *
                 * we actually do this to 'save' the provider number,
                 * this is shit, as we can't dynamically switch
                 * providers, the 'right' way to do it is to have every
                 * provider declare a unique id, and then lookthem up in
                 * a hash.
                 */
                win.debug('pre---', subtitle, metadata, torrents);

                var torrentPromises = _.map(torrents, function (torrentProvider) {
                    return getDataFromProvider(torrentProvider, subtitle, metadata, self)
                        .then(function (torrents) {
                            var results = torrents.results;


                            self.add(results);
                            self.hasMore = true;
                            self.trigger('sync', self);
                        }).catch(function (err) {
                            console.error('provider error err', err);
                        });
                });
            var self = this;

            if (this.state === 'loading' && !this.hasMore) {
                return;
            }

            this.state = 'loading';
            self.trigger('loading', self);

            var metadata = this.providers.metadata;
            var torrents = this.providers.torrents;

            var torrentPromises = torrents.filter(torrentProvider => (
                !torrentProvider.loading && torrentProvider.hasMore
            )).map((torrentProvider) => {
                var providers = {
                    torrent: torrentProvider,
                    metadata: metadata
                };

                torrentProvider.loading = true;
                return getDataFromProvider(providers, self)
                    .then(function (torrents) {
                        // set state, can't fail
                        torrentProvider.loading = false;
                        if (torrents.results.length !== 0) {
                            torrentProvider.page++;
                        } else {
                            torrentProvider.hasMore = false;
                        }

                        self.add(torrents.results);

                        // set state, can't fail
                        self.trigger('sync', self);
                        self.state = 'loaded';
                        self.trigger('loaded', self, self.state);
                    })
                    .catch(function (err) {
                        console.error('provider error err', err);
                    });
            });
        },

        fetchMore: function () {
            this.fetch();
        }
    });

    App.Model.Collection = PopCollection;
})(window.App);
