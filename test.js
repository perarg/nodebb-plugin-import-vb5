var fs = require('fs-extra');

require('./index').testrun({
    dbhost: 'localhost',
    dbport: 3306,
    dbname: 'psaxtiria',
    dbuser: 'root',
    dbpass: '',

	tablePrefix: ''
}, function(err, results) {
	console.log("getGroups", Object.keys(results[1]).length);
	console.log("getUsers", Object.keys(results[2]).length);
	console.log("getMessages", Object.keys(results[3]).length);
	console.log("getCategories", Object.keys(results[4]).length);
	console.log("getTopics", Object.keys(results[5]).length);
	console.log("getPosts", Object.keys(results[6]).length);
	var imagesCount;
	var attachCount;
	for (var i=0;i<results[6].length;i++)
	{
		if ( results[6][i]._images.length > 0 ) {
			//console.log(JSON.stringify(results[6][i]._images) + '\n');
			imagesCount++;
			console.log('IMAGE: '+imagesCount + '\n');
		}
		if ( results[6][i]._attachments.length > 0 ) {
			attachCount++;
			//console.log(JSON.stringify(results[6][i]._attachments) + '\n');
			console.log('ATTACH: '+attachCount + '\n');
		}
	}


	// will crash the process if there are attachmentBlobs
	fs.writeFileSync('./tmp.json', JSON.stringify(results[5][16374], undefined, 2));
});
