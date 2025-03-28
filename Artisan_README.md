Ian notes 3/27/25

## General notes
1. Anything mentioning entitlements goes away, Edge does not bill based on them.
2. Accounts == Organizations
3. Billing API is not used at all currently.
4. This repo is very in flux.

## Things that need to be done in general
1. Registration page needs to be updated with what we actually want.  Right now it's just sitting
 template.yaml file.  We should move that into an actual file (along with the css, js, etc.) and add 
 the fields we want, the icons, etc.
2. The billing logic I created is very bare bones, and we want to move it out to the Billing API anyway.
There may be some useful bits in that code, but it's going to go away.  Right now it runs once an hour and
just pulls the active account's cluster numbers and sends them to the billing API.  We want to only bill monthly,
but AWS wants us to send hourly records, so we need to send zeros hourly and then once a month send the actual data.
We need to update it to handle clusters that were active part of the month, as well as to handle billing ASAP for
any customer that deactivates their account entirely.
Billing is also done as one big batch for all accounts, we may want to move back to the old SQS approach of breaking things up.
3. The token retrieval logic is very basic, see the TODOs in the code.
4. The actual billing submission is commented out for safety.
5. We need to zip up the code and put it in the S3 bucket for the Lambda to use.  The old Cloudformation would just upload individual files, but we can't do that now that we're importing npm packages.  We can just upload the zip file to every lambda, but that's pretty wasteful.
6. Remove entitlements from the code.
7. Redo architecture diagram.
8. Get rid of the template and create Terraform files for the infrastructure.

## Cloudformation and Terraform notes
Based on above notes.
1. Remove entitlements from the Cloudformation.
2. Move the web files (html, css, js) into actual files.
3. Zip JS code and upload to S3 bucket, use that in the Lambdas.
4. Integrate the Billing API, fix the timing logic.
