const baseUrl = `https://1nqfs4j5s1.execute-api.us-east-1.amazonaws.com/Prod`;
const form = document.getElementsByClassName("form-signin")[0];

const showAlert = (cssClass, message) => {
  const html = `
    <div class="alert alert-${cssClass} alert-dismissible" role="alert">
        <strong>${message}</strong>
        <button class="close" type="button" data-dismiss="alert" aria-label="Close">
            <span aria-hidden="true">×</span>
        </button>
    </div>`;

  document.querySelector("#alert").innerHTML += html;
};

const formToJSON = (elements) =>
  [].reduce.call(
    elements,
    (data, element) => {
      data[element.name] = element.value;
      return data;
    },
    {}
  );

const getUrlParameter = (name) => {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  const regex = new RegExp(`[\\?&]${name}=([^&#]*)`);
  const results = regex.exec(location.search);
  return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
};

const handleFormSubmit = (event) => {
  event.preventDefault();

  const postUrl = `${baseUrl}/subscriber`;
  const regToken = getUrlParameter("x-amzn-marketplace-token");

  if (!regToken) {
    showAlert(
      "danger",
      "Registration Token Missing. Please go to AWS Marketplace and follow the instructions to set up your account!"
    );
  } else {
    const data = formToJSON(form.elements);
    data.regToken = regToken;

    const xhr = new XMLHttpRequest();

    xhr.open("POST", postUrl, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify(data));

    xhr.onreadystatechange = () => {
      if (xhr.readyState == XMLHttpRequest.DONE) {
        showAlert("primary", xhr.responseText);
        console.log(JSON.stringify(xhr.responseText));
      }
    };
  }
};

form.addEventListener("submit", handleFormSubmit);

const regToken = getUrlParameter("x-amzn-marketplace-token");
if (!regToken) {
  showAlert(
    "danger",
    "Registration Token Missing. Please go to AWS Marketplace and follow the instructions to set up your account!"
  );
}

/*
Potential data to populate script with:
- Product ID: prod-ab5ihozg5ylly
- Product ARN: arn:aws:aws-marketplace:us-east-1:534936370474:AWSMarketplace/SaaSProduct/prod-ab5ihozg5ylly
- Metering Service SNS Topic ARN (prob not required): arn:aws:sns:us-east-1:287250355862:aws-mp-subscription-notification-c9z0oe0qbge757tw4e5ey0fc0
- Entitlement Service SNS topic ARN: arn:aws:sns:us-east-1:287250355862:aws-mp-entitlement-notification-c9z0oe0qbge757tw4e5ey0fc0
*/