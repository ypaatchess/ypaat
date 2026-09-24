const {me}=require('../../lib/auth');
module.exports=async function(req,res){if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});try{return await me(req,res)}catch(e){console.error(e);return res.status(500).json({error:'Authentication service error'})}};
