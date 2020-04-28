var client = require('scp2')
// client.scp('file.txt', 'hfadmin@10.42.60.52:/home/hfadmin/testscp', function(err) {
//   console.log(err);
// })
// client.scp({
//     host: '10.42.60.52',
//     username: 'hfadmin',
//     path: '/home/hfadmin/testscp/file.txt'
// }, './', function(err) {})

client.scp('file.txt', {
    host: '10.42.60.52',
    username: 'hfadmin',
    privateKey: require("fs").readFileSync('/root/.ssh/id_rsa'),
    passphrase: '',
    path: '/home/hfadmin/testscp/'
}, function(err) {
  console.log(err);
})
