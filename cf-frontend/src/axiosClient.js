import axios from "axios";

export const makeClient = (password) =>
    axios.create({
        headers: password ? { "x-password": password } : {},
    });