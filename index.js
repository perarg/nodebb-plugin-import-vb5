
var extend = require('extend');
var async = require('async');
var mysql = require('mysql');
var _ = require('underscore');
var noop = function(){};
var logPrefix = '[nodebb-plugin-import-vb5]';

(function(Exporter) {

	var csvToArray = function(v) {
		return !Array.isArray(v) ? ('' + v).split(',').map(function(s) { return s.trim(); }) : v;
	};

	Exporter.setup = function(config, callback) {
		Exporter.log('setup');

		// mysql db only config
		// extract them from the configs passed by the nodebb-plugin-import adapter
		var _config = {
			host: config.dbhost || config.host || 'localhost',
			user: config.dbuser || config.user || 'user',
			password: config.dbpass || config.pass || config.password || undefined,
			port: config.dbport || config.port || 3306,
			database: config.dbname || config.name || config.database || 'vb'
		};

		Exporter.config(_config);
		Exporter.config('prefix', config.prefix || config.tablePrefix || '');

		config.custom = config.custom || {};
		if (typeof config.custom === 'string') {
			try {
				config.custom = JSON.parse(config.custom)
			} catch (e) {}
		}

		config.custom = config.custom || {};
		config.custom.timemachine = config.custom.timemachine || {};
		config.custom = extend(true, {}, {
			messagesPlugin: '',

			timemachine: {
				messages: {
					from: config.custom.timemachine.from || null,
					to: config.custom.timemachine.to || null
				},
				users: {
					from: config.custom.timemachine.from || null,
					to: config.custom.timemachine.to || null
				},
				topics: {
					from: config.custom.timemachine.from || null,
					to: config.custom.timemachine.to || null
				},
				categories: {
					from: config.custom.timemachine.from || null,
					to: config.custom.timemachine.to || null
				},
				posts: {
					from: config.custom.timemachine.from || null,
					to: config.custom.timemachine.to || null
				}
			}
		}, config.custom);

		Exporter.config('custom', config.custom);

		if (!config.custom.messagesPlugin) {
			Exporter.warn('\nNo chat plugin was entered in the custom config. Falling back to Core.'
				+ '\nWere you using a chat plugin for chat? if so, enter it in the custom config in the "pre import settings" as a valid JSON value. '
				+ '\ni.e. {"messagesPlugin": "arrowchat"} or {"messagesPlugin": "cometchat"}'
				+ '\nCurrently the supported plugins are: ' + Object.keys(supportedPlugins).join(', ') + '\n');
		}

		Exporter.connection = mysql.createConnection(_config);
		Exporter.connection.connect();

		callback(null, Exporter.config());
	};

	Exporter.query = function(query, callback) {
		if (!Exporter.connection) {
			var err = {error: 'MySQL connection is not setup. Run setup(config) first'};
			Exporter.error(err.error);
			return callback(err);
		}

		console.log('\n\n====QUERY====\n\n' + query + '\n');
		Exporter.connection.query(query, function(err, rows) {
			if (rows) {
				console.log('returned: ' + rows.length + ' results');
			}
			callback(err, rows)
		});
	};
	var getSystemGroups = function(config, callback) {
		if (_.isFunction(config)) {
			callback = config;
			config = {};
		}
		callback = !_.isFunction(callback) ? noop : callback;
		if (!Exporter.connection) {
			Exporter.setup(config);
		}
		var prefix = Exporter.config('prefix');
		var query = 'SELECT '
			+ prefix + 'usergroup.usergroupid as _gid, '
			+ prefix + 'usergroup.title as _title, ' // not sure, just making an assumption
			+ prefix + 'usergroup.pmpermissions as _pmpermissions, ' // not sure, just making an assumption
			+ prefix + 'usergroup.adminpermissions as _adminpermissions ' // not sure, just making an assumption
			+ ' from ' + prefix + 'usergroup ';
		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				var map = {};

				//figure out the admin group
				var max = 0, admingid;
				rows.forEach(function(row) {
					var adminpermission = parseInt(row._adminpermissions, 10);
					if (adminpermission) {
						if (adminpermission > max) {
							max = adminpermission;
							admingid = row._gid;
						}
					}
				});

				rows.forEach(function(row) {
					if (! parseInt(row._pmpermissions, 10)) {
						row._banned = 1;
						row._level = 'member';
					} else if (parseInt(row._adminpermissions, 10)) {
						row._level = row._gid === admingid ? 'administrator' : 'moderator';
						row._banned = 0;
					} else {
						row._level = 'member';
						row._banned = 0;
					}
					map[row._gid] = row;
				});
				// keep a copy of the users in memory here
				Exporter._groups = map;
				callback(null, map);
			});
	};

	Exporter.getGroups = function(callback) {
		return Exporter.getPaginatedGroups(0, -1, callback);
	};

	Exporter.getPaginatedGroups = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix') || '';
		var startms = +new Date();

		var query = 'SELECT '
			+ prefix + 'socialgroup.groupid as _gid, '
			+ prefix + 'socialgroup.name as _name, '
			+ prefix + 'socialgroup.description as _description, '
			+ prefix + 'socialgroup.creatoruserid as _ownerUId '

			+ 'FROM ' + prefix + 'socialgroup '
			+ 'WHERE '	+ prefix + 'socialgroup.groupid >= 0 '

			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				//normalize here
				var map = {};

				rows.forEach(function(row) {
					map[row._gid] = row;
				});

				callback(null, map);
			});
	};

	Exporter.countUsers = function (callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix') || '';
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*) '
			+ 'FROM ' + prefix + 'user '
			+ 'LEFT JOIN ' + prefix + 'sigparsed ON ' + prefix + 'sigparsed.userid=' + prefix + 'user.userid '
			+ 'LEFT JOIN ' + prefix + 'customavatar ON ' + prefix + 'customavatar.userid=' + prefix + 'user.userid '

			+ ' WHERE 1=1 '
			+ (timemachine.users.from ? ' AND ' + prefix + 'user.joindate >= ' + timemachine.users.from : ' ')
			+ (timemachine.users.to ? ' AND  ' + prefix + 'user.joindate <= ' + timemachine.users.to : ' ')
			+ '';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	Exporter.getUsers = function(callback) {
		return Exporter.getPaginatedUsers(0, -1, callback);
	};
	Exporter.getPaginatedUsers = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix') || '';
		var timemachine = Exporter.config('custom').timemachine;

		var startms = +new Date();

		var query = 'SELECT '
			+ prefix + 'user.userid as _uid, '
			+ prefix + 'user.email as _email, '
			+ prefix + 'user.username as _username, '
			+ prefix + 'sigparsed.signatureparsed as _signature, '
			+ prefix + 'user.joindate as _joindate, '
			+ prefix + 'user.secret as _hashed_password, '
			+ prefix + 'customavatar.filename as _pictureFilename, '
			+ prefix + 'customavatar.filedata as _pictureBlob, '
			+ prefix + 'user.homepage as _website, '

			+ 'CONCAT(\'[\', GROUP_CONCAT(DISTINCT ' + prefix + 'socialgroup.groupid ), \']\') AS _groups, '

			+ prefix + 'user.reputation as _reputation, '
			+ prefix + 'user.profilevisits as _profileviews, '
			+ prefix + 'user.birthday as _birthday '
			+ 'FROM ' + prefix + 'user '

			+ 'LEFT JOIN ' + prefix + 'socialgroupmember ON ' + prefix + 'socialgroupmember.userid = ' + prefix + 'user.userid '
			+ 'LEFT JOIN ' + prefix + 'socialgroup ON ' + prefix + 'socialgroup.groupid = ' + prefix + 'socialgroupmember.groupid '

			+ 'LEFT JOIN ' + prefix + 'sigparsed ON ' + prefix + 'sigparsed.userid=' + prefix + 'user.userid '
			+ 'LEFT JOIN ' + prefix + 'customavatar ON ' + prefix + 'customavatar.userid=' + prefix + 'user.userid '

			+ ' WHERE 1=1 '
			+ (timemachine.users.from ? ' AND ' + prefix + 'user.joindate >= ' + timemachine.users.from : ' ')
			+ (timemachine.users.to ? ' AND  ' + prefix + 'user.joindate <= ' + timemachine.users.to : ' ')

			+ ' GROUP BY ' + prefix + 'user.userid '

			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');


		getSystemGroups(function(err, systemgroups) {
			if (err) {
				Exporter.error(err);
				return callback(err);
			}

			Exporter.query(query,
				function(err, rows) {
					if (err) {
						Exporter.error(err);
						return callback(err);
					}

					//normalize here
					var map = {};
					rows.forEach(function(row, i) {
						if (row._groups) {
							try {
								row._groups = JSON.parse(row._groups);
							} catch(e) {
								Exporter.warn("skipping userid's groups, something went wrong while parsing", row._groups);
								row._groups = [];
							}
						}

						// from unix timestamp (s) to JS timestamp (ms)
						row._joindate = ((row._joindate || 0) * 1000) || startms;

						// lower case the email for consistency
						row._email = (row._email || '').toLowerCase();
						row._website = Exporter.validateUrl(row._website);

						row._level = (systemgroups[row._gid] || {})._level || '';
						row._banned = (systemgroups[row._gid] || {})._banned || 0;

						map[row._uid] = row;
					});

					callback(null, map);
				});
		});
	};

	var countCometChatMessages = function(callback) {
		callback = !_.isFunction(callback) ? noop : callback;
		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*) FROM ' + prefix + 'cometchat '
			+ ' WHERE 1=1 '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'cometchat.sent >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'cometchat.sent <= ' + timemachine.messages.to : ' ')
			+ '';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	var getCometChatPaginatedMessages = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var startms = +new Date();
		var prefix = Exporter.config('prefix') || '';
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT '
			+ prefix + 'cometchat.id as _mid, '
			+ prefix + 'cometchat.from as _fromuid, '
			+ prefix + 'cometchat.to as _touid, '
			+ prefix + 'cometchat.message as _content, '
			+ prefix + 'cometchat.sent as _timestamp, '
			+ prefix + 'cometchat.read as _read '
			+ 'FROM ' + prefix + 'cometchat '

			+ ' WHERE 1=1 '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'cometchat.sent >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'cometchat.sent <= ' + timemachine.messages.to : ' ')

			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				//normalize here
				var map = {};
				rows.forEach(function(row) {
					row._timestamp = ((row._timestamp || 0) * 1000) || startms;
					map[row._mid] = row;
				});

				callback(null, map);
			});
	};

	var countArrowChatMessages = function(callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*) FROM ' + prefix + 'arrowchat '
			+ ' WHERE 1=1 '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'arrowchat.sent >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'arrowchat.sent <= ' + timemachine.messages.to : ' ')
			+ '';


		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	var getArrowChatPaginatedMessages = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var startms = +new Date();
		var prefix = Exporter.config('prefix') || '';
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT '
			+ prefix + 'arrowchat.id as _mid, '
			+ prefix + 'arrowchat.from as _fromuid, '
			+ prefix + 'arrowchat.to as _touid, '
			+ prefix + 'arrowchat.message as _content, '
			+ prefix + 'arrowchat.sent as _timestamp, '
			+ prefix + 'arrowchat.read as _read '
			+ 'FROM ' + prefix + 'arrowchat '

			+ ' WHERE 1=1 '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'arrowchat.sent >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'arrowchat.sent <= ' + timemachine.messages.to : ' ')

			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				//normalize here
				var map = {};
				rows.forEach(function(row) {
					row._timestamp = ((row._timestamp || 0) * 1000) || startms;
					map[row._mid] = row;
				});

				callback(null, map);
			});
	};

	var supportedPlugins = {
		cometchat: {
			'get': getCometChatPaginatedMessages,
			'count': countCometChatMessages
		},
		arrowchat: {
			'get': getArrowChatPaginatedMessages,
			'count': countArrowChatMessages
		}
	};

	Exporter.countMessages = function(callback) {
		var custom = Exporter.config('custom') || {};
		custom.messagesPlugin = (custom.messagesPlugin || '').toLowerCase();

		if (supportedPlugins[custom.messagesPlugin]) {
			return supportedPlugins[custom.messagesPlugin].count(callback);
		}

		callback = !_.isFunction(callback) ? noop : callback;
		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*) '
			+ 'FROM ' + prefix + 'pm '
			+ 'JOIN ' + prefix + 'pmtext ON ' + prefix + 'pmtext.pmtextid=' + prefix + 'pm.pmtextid '
			+ 'JOIN ' + prefix + 'user ON ' + prefix + 'pmtext.fromuserid=' + prefix + 'user.userid '
			+ 'WHERE ' + prefix + 'pmtext.fromuserid != ' + prefix + 'pm.userid '
			+ 'AND EXISTS ( SELECT * FROM ' + prefix + 'user WHERE ' + prefix + 'user.userid = ' + prefix + 'pm.userid) '
			+ 'AND ' + prefix + 'pmtext.fromuserid != ' + prefix + 'pm.userid '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'pmtext.dateline >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'pmtext.dateline <= ' + timemachine.messages.to : ' ')
			+ '';


		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	Exporter.getMessages = function(callback) {
		return Exporter.getPaginatedMessages(0, -1, callback);
	};

	Exporter.getPaginatedMessages = function(start, limit, callback) {
		var custom = Exporter.config('custom') || {};
		custom.messagesPlugin = (custom.messagesPlugin || '').toLowerCase();

		if (supportedPlugins[custom.messagesPlugin]) {
			return supportedPlugins[custom.messagesPlugin].get(start, limit, callback);
		}

		callback = !_.isFunction(callback) ? noop : callback;

		var startms = +new Date();
		var prefix = Exporter.config('prefix') || '';
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT '
			+ prefix + 'pm.pmid as _mid, '
			+ prefix + 'pmtext.fromuserid as _fromuid, '
			+ prefix + 'pm.userid as _touid, '
			+ prefix + 'pmtext.message as _content, '
			+ prefix + 'pmtext.dateline as _timestamp '
			+ 'FROM ' + prefix + 'pm '
			+ 'JOIN ' + prefix + 'pmtext ON ' + prefix + 'pmtext.pmtextid=' + prefix + 'pm.pmtextid '
			+ 'JOIN ' + prefix + 'user ON ' + prefix + 'pmtext.fromuserid=' + prefix + 'user.userid '
			+ 'WHERE ' + prefix + 'pmtext.fromuserid != ' + prefix + 'pm.userid '
			+ 'AND EXISTS ( SELECT * FROM ' + prefix + 'user WHERE ' + prefix + 'user.userid = ' + prefix + 'pm.userid) '
			+ (timemachine.messages.from ? ' AND ' + prefix + 'pmtext.dateline >= ' + timemachine.messages.from : ' ')
			+ (timemachine.messages.to ? ' AND  ' + prefix + 'pmtext.dateline <= ' + timemachine.messages.to : ' ')
			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				//normalize here
				var map = {};
				rows.forEach(function(row) {
					row._timestamp = ((row._timestamp || 0) * 1000) || startms;
					map[row._mid] = row;
				});

				callback(null, map);
			});
	};

	Exporter.countCategories = function(callback) {
		callback = !_.isFunction(callback) ? noop : callback;
		var prefix = Exporter.config('prefix');
		var query = 'SELECT count(*) FROM ' + prefix + 'node where contenttypeid=29';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	Exporter.getCategories = function(callback) {
		return Exporter.getPaginatedCategories(0, -1, callback);
	};

	Exporter.getPaginatedCategories = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix');
		var startms = +new Date();

		var query = 'SELECT '
			+ prefix + 'node.nodeid as _cid, '
			+ prefix + 'node.title as _name, '
			+ prefix + 'node.description as _description, '
			+ prefix + 'node.displayorder as _order '
			+ 'FROM ' + prefix + 'node '
			+ 'where node.contenttypeid=29 '
			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}

				//normalize here
				var map = {};
				rows.forEach(function(row, i) {
					row._name = row._name || 'Untitled Category ';
					row._description = row._description || 'No decsciption available';
					row._timestamp = ((row._timestamp || 0) * 1000) || startms;
					map[row._cid] = row;
				});

				callback(null, map);
			});
	};

	var getPostsAttachmentsMap = function (callback) {
		// per vb contenttype table
		getAttachmentsMap(1, function (err, rows) {
			var map = {};
			var filePath = '';
			var fileType = '';
			console.log('LENGTH: ' + rows.length);
			rows.forEach(function(row) {
				// use both, the pid and the uid to make sure post and the user ids match, for some reason even with the contenttypeid filter, some attachments didn't belong
				map[row._contentid + '_' + row._uid] = map[row._contentid + '_' + row._uid] || [];
				filePath = __dirname +'/tmp/attachments/'+row._fname+'.'+row._extension;
				if (row._extension === 'bmp' ||
					row._extension === 'gif' ||
					row._extension === 'jpg' ||
					row._extension === 'jpeg' ||
					row._extension === 'png'
					)
				{
					fileType = 'image';
				}
				else { fileType = 'attachment'; }
				map[row._contentid + '_' + row._uid].push({fileType: fileType, path: filePath});
			});

			callback(err, map);
		});
	};


	var getAttachmentsMap = function (contenttypeid, callback) {
		callback = !_.isFunction(callback) ? noop : callback;
		var prefix = Exporter.config('prefix');

		if (Exporter['_attachmentsMap_' + contenttypeid]) {
			return callback(null, Exporter['_attachmentsMap_' + contenttypeid]);
		}

		var query = 'SELECT '
			+ prefix + 'node.parentid as _contentid, '
			+ prefix + 'attachment.userid as _uid, '
			+ prefix + 'attachment.filedataid as _fname, '
			+ prefix + 'filedata.extension as _extension '
			//+ prefix + 'filedata.filedata as _blob '
			+ 'FROM ' + prefix + 'attach '
			+ 'JOIN ' + prefix + 'node ON ' + prefix + 'attach.nodeid = '+ prefix + 'node.nodeid '
			+ 'JOIN ' + prefix + 'attachment ON ' + prefix + 'attach.filedataid = '+ prefix + 'attachment.filedataid '		
			+ 'JOIN ' + prefix + 'filedata ON ' + prefix + 'attachment.filedataid = ' + prefix + 'filedata.filedataid '
			+ 'WHERE ' + prefix + 'attachment.contenttypeid=' + contenttypeid ;
			// checking for NULL is faster, so let it quit before checking the length, if NULL
			//+ 'AND ' + prefix + 'filedata.filedata IS NOT NULL '
			//+ 'AND LENGTH(' + prefix + 'filedata.filedata) > 0 ';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}

				Exporter['_attachmentsMap_' + contenttypeid] = rows;

				callback(null, rows);
			});
	};

	Exporter.countTopics = function(callback) {
		callback = !_.isFunction(callback) ? noop : callback;
		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*) '
			+ 'FROM ' + prefix + 'thread_post, '
			+ prefix + 'node '
			+ ' WHERE ' + prefix + 'thread_post.nodeid = ' + prefix + 'node.nodeid '
			//+ 'JOIN ' + prefix + 'node ON ' + prefix + 'thread_post.nodeid=' + prefix + 'node.nodeid '
			+ (timemachine.topics.from ? ' AND ' + prefix + 'node.publishdate >= ' + timemachine.topics.from : ' ')
			+ (timemachine.topics.to ? ' AND  ' + prefix + 'node.publishdate <= ' + timemachine.topics.to : ' ')
			+ '';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	Exporter.getTopics = function(callback) {
		return Exporter.getPaginatedTopics(0, -1, callback);
	};
	Exporter.getPaginatedTopics = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var startms = +new Date();
		var query = 'SELECT '
			+ prefix + 'thread_post.threadid as _tid, '
			+ prefix + 'node.userid as _uid, '
			+ prefix + 'thread_post.postid as _pid, '
			+ prefix + 'node.parentid as _cid, '
			+ prefix + 'node.public_preview as _visible, '
			+ prefix + 'node.title as _title, '
			+ prefix + 'text.rawtext as _content, '
			+ prefix + 'thread_post.nodeid as _nodeid, '
			//+ prefix + 'node.hasphoto as _attached, '
			+ prefix + 'node.authorname as _guest, '
			+ prefix + 'node.ipaddress as _ip, '
			+ prefix + 'node.publishdate as _timestamp, '
			+ prefix + 'node.totalcount as _viewcount, '
			+ prefix + 'node.open as _open, '
			+ prefix + 'node.sticky as _pinned '
			+ ' FROM ' + prefix + 'thread_post, '
			+ prefix + 'node, '
			+ prefix + 'text '
			+ ' WHERE ' + prefix + 'thread_post.nodeid = ' + prefix + 'node.nodeid '
			+ ' AND ' + prefix + 'node.nodeid = ' + prefix + 'text.nodeid '
			//+ ' JOIN ' + prefix + 'node ON ' + prefix + 'thread_post.nodeid=' + prefix + 'node.nodeid '
			//+ ' JOIN ' + prefix + 'text ON ' + prefix + 'text.nodeid=' + prefix + 'node.nodeid '
			+ (timemachine.topics.from ? ' AND ' + prefix + 'node.publishdate >= ' + timemachine.topics.from : ' ')
			+ (timemachine.topics.to ? ' AND  ' + prefix + 'node.publishdate <= ' + timemachine.topics.to : ' ')

			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		getPostsAttachmentsMap(function(err, attachmentsMap) {
			if (err)
				return callback(err);

			Exporter.query(query,
				function(err, rows) {
					if (err) {
						Exporter.error(err);
						return callback(err);
					}

					//normalize here
					var map = {};
					rows.forEach(function(row, i) {
						row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
						row._timestamp = ((row._timestamp || 0) * 1000) || startms;
						row._locked = row._open ? 0 : 1;

						row._deleted = row._visible == 2 ? 1 : 0;
						delete row._visible;

						row._images=[];
						row._attachments=[];
						
						if (attachmentsMap[row._nodeid + '_' + row._uid]){
							//console.log(JSON.stringify(attachmentsMap[row._pid + '_' + row._uid]) + '\n');
							for(var ccc=0; ccc < attachmentsMap[row._nodeid + '_' + row._uid].length ; ccc++)
							{
								if (attachmentsMap[row._nodeid + '_' + row._uid][ccc].fileType == "image")
								{
									row._images.push(attachmentsMap[row._nodeid + '_' + row._uid][ccc].path);
								}else if (attachmentsMap[row._nodeid + '_' + row._uid][ccc].fileType == "attachment") {
									row._attachments.push(attachmentsMap[row._nodeid + '_' + row._uid][ccc].path);
								}
							}
						}

						//row._attachmentsBlobs = attachmentsMap[row._pid + '_' + row._uid];
						/*if (row._attachmentsBlobs && row._attached != row._attachmentsBlobs.length) {
							delete row._attachmentsBlobs;
						}*/

						map[row._tid] = row;
					});

					callback(null, map, rows);
				});
		});

	};

	Exporter.countPosts = function(callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var query = 'SELECT count(*)  '
			+ 'FROM ' + prefix + 'node '
			+ 'LEFT OUTER JOIN ' + prefix + 'thread_post ON ' + prefix + 'node.nodeid = ' + prefix + 'thread_post.nodeid '
			+ ' AND ' + prefix + 'node.contenttypeid = 30 '
			+ (timemachine.posts.from ? ' AND ' + prefix + 'node.publishdate >= ' + timemachine.posts.from : ' ')
			+ (timemachine.posts.to ? ' AND  ' + prefix + 'node.publishdate <= ' + timemachine.posts.to : ' ')
			+ '';

		Exporter.query(query,
			function(err, rows) {
				if (err) {
					Exporter.error(err);
					return callback(err);
				}
				callback(null, rows[0]['count(*)']);
			});
	};

	Exporter.getPosts = function(callback) {
		return Exporter.getPaginatedPosts(0, -1, callback);
	};

	Exporter.getPaginatedPosts = function(start, limit, callback) {
		callback = !_.isFunction(callback) ? noop : callback;

		var prefix = Exporter.config('prefix');
		var timemachine = Exporter.config('custom').timemachine;

		var startms = +new Date();
		var query = 'SELECT '
			+ prefix + 'node.nodeid as _pid, '
			+ prefix + 'thread_post.threadid as _tid, '
			+ prefix + 'node.userid as _uid, '
			//+ prefix + 'node.inlist as _visible, '
			//+ prefix + 'node.authorname as _guest, '
			//+ prefix + 'text.attach as _attached, '
			+ prefix + 'node.ipaddress as _ip, '
			+ prefix + 'node.parentid as _toPid, '
			+ prefix + 'text.rawtext as _content, '
			+ prefix + 'node.publishdate as _timestamp '
			+ ' FROM ' + prefix + 'node, '
			+ prefix + 'thread_post, '
			+ prefix + 'text '
			+ ' WHERE ' + prefix + 'node.parentid = ' + prefix + 'thread_post.nodeid '
			+ ' AND '+ prefix + 'node.nodeid = '+ prefix + ' text.nodeid '
			+ ' AND '+ prefix + 'node.contenttypeid=30 '
			+ (timemachine.posts.from ? ' AND ' + prefix + 'node.publishdate >= ' + timemachine.posts.from : ' ')
			+ (timemachine.posts.to ? ' AND  ' + prefix + 'node.publishdate <= ' + timemachine.posts.to : ' ')
			+ ' ORDER BY ' + prefix + 'node.publishdate ASC '
			+ (start >= 0 && limit >= 0 ? ' LIMIT ' + start + ',' + limit : '');

		getPostsAttachmentsMap(function(err, attachmentsMap) {
			if (err) {
				return callback(err);
			}
			Exporter.query(query,
				function(err, rows) {
					if (err) {
						Exporter.error(err);
						return callback(err);
					}

					//normalize here
					var map = {};
					rows.forEach(function(row) {
						row._content = row._content || '';
						row._timestamp = ((row._timestamp || 0) * 1000) || startms;
						if (row._toPid == 0) {
							delete row._toPid;
						}

						row._deleted = row._visible == 2 ? 1 : 0;
						delete row._visible;

						map[row._pid] = row;
						row._images=[];
						row._attachments=[];
						
						if (attachmentsMap[row._pid + '_' + row._uid]){
							//console.log(JSON.stringify(attachmentsMap[row._pid + '_' + row._uid]) + '\n');
							for(var ccc=0; ccc < attachmentsMap[row._pid + '_' + row._uid].length ; ccc++)
							{
								if (attachmentsMap[row._pid + '_' + row._uid][ccc].fileType == "image")
								{
									row._images.push(attachmentsMap[row._pid + '_' + row._uid][ccc].path);
								}else if (attachmentsMap[row._pid + '_' + row._uid][ccc].fileType == "attachment") {
									row._attachments.push(attachmentsMap[row._pid + '_' + row._uid][ccc].path);
								}
							}
						}

						//row._attachmentsBlobs = attachmentsMap[row._pid + '_' + row._uid];
/*						if (row._attachmentsBlobs && row._attached != row._attachmentsBlobs.length) {
							delete row._attachmentsBlobs;
						}*/
					});

					callback(null, map, rows);
				});
		});
	};

	Exporter.teardown = function(callback) {
		Exporter.log('teardown');
		Exporter.connection.end();

		Exporter.log('Done');
		callback();
	};

	Exporter.testrun = function(config, callback) {
		async.series([
			function(next) {
				Exporter.setup(config, next);
			},
			function(next) {
				Exporter.getGroups(next);
			},
			function(next) {
				Exporter.getUsers(next);
			},
			function(next) {
				Exporter.getMessages(next);
			},
			function(next) {
				Exporter.getCategories(next);
			},
			function(next) {
				Exporter.getTopics(function(err, map, arr) {
					next(err, arr);
				});
			},
/*			function(next) {
				Exporter.getPosts(function(err, map, arr) {
					next(err, arr);
				});
			},*/
			function(next) {
				Exporter.teardown(next);
			}
		], callback);
	};

	Exporter.paginatedTestrun = function(config, callback) {
		async.series([
			function(next) {
				Exporter.setup(config, next);
			},
			function(next) {
				Exporter.getPaginatedGroups(0, 1000, next);
			},
			function(next) {
				Exporter.getPaginatedUsers(0, 1000, next);
			},
			function(next) {
				Exporter.getPaginatedMessages(0, 1000, next);
			},
			function(next) {
				Exporter.getPaginatedCategories(0, 1000, next);
			},
			function(next) {
				Exporter.getPaginatedTopics(0, 1000, function(err, map) {
					next(err, map);
				});
			},
			function(next) {
				Exporter.getPaginatedPosts(1001, 2000, next);
			},
			function(next) {
				Exporter.teardown(next);
			}
		], callback);
	};

	Exporter.warn = function() {
		var args = _.toArray(arguments);
		args.unshift(logPrefix);
		console.warn.apply(console, args);
	};

	Exporter.log = function() {
		var args = _.toArray(arguments);
		args.unshift(logPrefix);
		console.log.apply(console, args);
	};

	Exporter.error = function() {
		var args = _.toArray(arguments);
		args.unshift(logPrefix);
		console.error.apply(console, args);
	};

	Exporter.config = function(config, val) {
		if (config != null) {
			if (typeof config === 'object') {
				Exporter._config = config;
			} else if (typeof config === 'string') {
				if (val != null) {
					Exporter._config = Exporter._config || {};
					Exporter._config[config] = val;
				}
				return Exporter._config[config];
			}
		}
		return Exporter._config;
	};

	// from Angular https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L11
	Exporter.validateUrl = function(url) {
		var pattern = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
		return url && url.length < 2083 && url.match(pattern) ? url : '';
	};

	Exporter.truncateStr = function(str, len) {
		if (typeof str != 'string') return str;
		len = _.isNumber(len) && len > 3 ? len : 20;
		return str.length <= len ? str : str.substr(0, len - 3) + '...';
	};

	Exporter.whichIsFalsy = function(arr) {
		for (var i = 0; i < arr.length; i++) {
			if (!arr[i])
				return i;
		}
		return null;
	};

})(module.exports);
